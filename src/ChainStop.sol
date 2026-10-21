// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

interface IMarginBank {
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function getPosition(address account, address pool)
        external view returns (int128 size, uint128 avgEntryPrice, int256 entryFundingIndex, uint64 updatedNs);
}

interface IPerpPool {
    function placeOrder(
        bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs,
        uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k
    ) external returns (bool success, uint128 orderId);
    function tryGetMarkPrice() external view returns (bool ok, uint256 price);
    function getOrderBookParameters() external view returns (uint256 tickSize, uint256 minQuantity, uint256 lotSize);
}

interface IReactivity {
    struct SubscriptionData {
        bytes32[4] eventTopics;
        address origin;
        address caller;
        address emitter;
        address handlerContractAddress;
        bytes4 handlerFunctionSelector;
        uint64 priorityFeePerGas;
        uint64 maxFeePerGas;
        uint64 gasLimit;
        bool isGuaranteed;
        bool isCoalesced;
    }
    function subscribe(SubscriptionData calldata data) external returns (uint256 subscriptionId);
}

/// A stop-loss that lives on-chain. This contract is its own perps account:
/// it holds the margin and the position. Every 5 seconds the chain itself
/// wakes it (a one-shot Schedule subscription it renews each time); it reads
/// the mark price and, once price is at or below the stop, sells to close.
/// No bot, no keeper, no server.
contract ChainStop {
    address constant REACTIVITY = 0x0000000000000000000000000000000000000100;
    bytes32 constant SCHEDULE_TOPIC = keccak256("Schedule(uint256)");
    uint64 constant TICK_MS = 5_000;
    uint64 constant FAR_EXPIRY_NS = type(uint64).max;
    uint8 constant IOC = 2;

    address public immutable owner;
    IERC20 public immutable usdso;
    IMarginBank public immutable bank;
    IPerpPool public immutable pool;

    uint256 public stopPrice;   // 18 decimals, USDso per whole base
    uint32 public ticksLeft;    // safety cap so a quiet market can't burn the gas budget
    uint32 public ticks;
    uint64 public gasLimit = 40_000_000;
    uint64 public priorityFee = 2 gwei;
    uint64 public maxFee = 20 gwei;

    event Armed(uint256 stopPrice, uint256 markPrice, uint32 maxTicks);
    event Tick(uint32 n, uint256 markPrice, uint256 stopPrice);
    event StopFired(uint256 markPrice, uint256 stopPrice, int128 closedSize, bool success);
    event Disarmed(string reason);

    modifier onlyOwner() {
        require(msg.sender == owner, "owner");
        _;
    }

    constructor(IERC20 usdso_, IMarginBank bank_, IPerpPool pool_) {
        owner = msg.sender;
        usdso = usdso_;
        bank = bank_;
        pool = pool_;
    }

    receive() external payable {}

    function fund(uint256 amount) external onlyOwner {
        usdso.approve(address(bank), amount);
        bank.deposit(amount);
    }

    /// Open a long with an IOC buy at most `maxPrice`.
    function openLong(uint256 quantity, uint256 maxPrice) external onlyOwner {
        pool.placeOrder(true, 0, maxPrice, quantity, FAR_EXPIRY_NS, IOC, 0, address(0), 0);
    }

    /// Set the stop and start the 5-second chain alarm.
    function arm(uint256 stopPrice_, uint32 maxTicks) external onlyOwner {
        (bool ok, uint256 mark) = pool.tryGetMarkPrice();
        require(ok && stopPrice_ < mark, "stop must be below mark");
        stopPrice = stopPrice_;
        ticksLeft = maxTicks;
        ticks = 0;
        emit Armed(stopPrice_, mark, maxTicks);
        _scheduleNext();
    }

    function disarm() external onlyOwner {
        ticksLeft = 0;
        emit Disarmed("owner");
    }

    /// Called by the chain (msg.sender is the reactivity precompile).
    function onEvent(address, bytes32[] calldata, bytes calldata) external {
        require(msg.sender == REACTIVITY, "only chain");
        if (ticksLeft == 0) return;
        ticksLeft--;
        ticks++;

        (bool ok, uint256 mark) = pool.tryGetMarkPrice();
        if (ok && mark <= stopPrice) {
            ticksLeft = 0;
            _close(mark);
            return;
        }
        emit Tick(ticks, ok ? mark : 0, stopPrice);
        if (ticksLeft == 0) {
            emit Disarmed("max ticks");
            return;
        }
        _scheduleNext();
    }

    function _close(uint256 mark) internal {
        (int128 size,,,) = bank.getPosition(address(this), address(pool));
        if (size <= 0) {
            emit StopFired(mark, stopPrice, 0, false);
            return;
        }
        (uint256 tick,,) = pool.getOrderBookParameters();
        uint256 floor = (mark * 98 / 100) / tick * tick; // 2% slippage room for the IOC
        try pool.placeOrder(false, 0, floor, uint256(uint128(size)), FAR_EXPIRY_NS, IOC, 0, address(0), 0) returns (bool s, uint128) {
            emit StopFired(mark, stopPrice, size, s);
        } catch {
            emit StopFired(mark, stopPrice, size, false);
        }
    }

    function _scheduleNext() internal {
        IReactivity.SubscriptionData memory d;
        d.eventTopics[0] = SCHEDULE_TOPIC;
        d.eventTopics[1] = bytes32(uint256(block.timestamp) * 1000 + TICK_MS);
        d.emitter = REACTIVITY;
        d.handlerContractAddress = address(this);
        d.handlerFunctionSelector = this.onEvent.selector;
        d.priorityFeePerGas = priorityFee;
        d.maxFeePerGas = maxFee;
        d.gasLimit = gasLimit;
        IReactivity(REACTIVITY).subscribe(d);
    }

    /// Owner-only exit: market-sell any position, pull margin, return funds.
    function closeNow(uint256 minPrice) external onlyOwner {
        (int128 size,,,) = bank.getPosition(address(this), address(pool));
        if (size > 0) pool.placeOrder(false, 0, minPrice, uint256(uint128(size)), FAR_EXPIRY_NS, IOC, 0, address(0), 0);
    }

    function withdrawMargin(uint256 amount) external onlyOwner {
        bank.withdraw(amount);
    }

    function sweep() external onlyOwner {
        uint256 bal = usdso.balanceOf(address(this));
        if (bal > 0) usdso.transfer(owner, bal);
        (bool ok,) = owner.call{value: address(this).balance}("");
        require(ok, "stt");
    }
}
