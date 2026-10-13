// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title RollingWindow
/// @author Hodd
/// @notice A spending budget over a rolling 24-hour window, kept in hourly buckets.
///
/// @dev GUARANTEE. Time is cut into hours, `hour(t) = floor(t / 3600)`. A spend at time `t` is
///      booked into bucket `hour(t)` and counts against every budget check made at a time `T`
///      with `hour(T) <= hour(t) + 24`, i.e. the current hour and the 24 hours before it (25
///      buckets). So a spend counts for AT LEAST 24 hours (it is still counted at `t + 24h`
///      exactly) and for less than 25 hours: it is released at the first second of hour
///      `hour(t) + 25`. Consequently, for any two spends that are at most 24 hours apart, the
///      later one's check sees the earlier one, and the total of all spends inside any 24-hour
///      span can never exceed the limit that applied to the last of them (no double spend at an
///      hour, day or any other boundary). The price of the exact-hour bookkeeping is that the
///      budget can be locked for up to one hour longer than 24 hours (never shorter).
///
///      LAYOUT. Buckets live in a 32-slot ring (`hour % 32`, 32 > 25 so the live hours never
///      alias), packed four `uint64` per storage word. `sum` caches the total of the live
///      buckets. Invariant: every ring slot whose hour is outside `[lastHour - 24, lastHour]`
///      is zero. `advance` keeps it true by zeroing the buckets that fall out of the window.
///      Limits and bucket values are bounded by `type(uint64).max` (the caller enforces the
///      limit bound, `SafeCast` guards the narrowing).
///
///      If the clock ever went backwards the window stays anchored at its latest hour: spends are
///      booked into that hour, which is conservative.
library RollingWindow {
    using SafeCast for uint256;

    /// @dev Length of one bucket.
    uint256 internal constant BUCKET = 1 hours;
    /// @dev Hours kept besides the current one: 24 + 1 = 25 live buckets.
    uint256 internal constant LOOKBACK = 24;
    /// @dev Ring size, a multiple of 4 that is larger than the 25 live buckets.
    uint256 internal constant RING = 32;

    struct Window {
        uint64 sum; // total of the live buckets [lastHour - 24, lastHour]
        uint40 lastHour; // newest hour the window has been advanced to
        uint256[8] ring; // 32 buckets of uint64, four per word
    }

    /// @dev Amount counted against the budget at time `ts` (read only).
    function spent(Window storage w, uint256 ts) internal view returns (uint256 total) {
        total = w.sum;
        if (total == 0) return 0;
        uint256 last = w.lastHour;
        uint256 hour_ = ts / BUCKET;
        if (hour_ <= last) return total;
        uint256 steps = hour_ - last;
        if (steps > LOOKBACK + 1) return 0;
        for (uint256 i; i < steps; ++i) {
            // hours last-24, last-23, ... drop out; (last + 8) % 32 == (last - 24) % 32
            total -= _get(w, (last + 8 + i) % RING);
        }
    }

    /// @dev Books `amount` at time `ts` unless it would push the window total above `limit`.
    /// @return ok False if the limit would be exceeded (nothing is booked, but the window has
    ///         been advanced; revert if you do not want that).
    /// @return total The window total including `amount`.
    function tryAdd(Window storage w, uint256 ts, uint256 amount, uint256 limit)
        internal
        returns (bool ok, uint256 total)
    {
        _advance(w, ts / BUCKET);
        total = uint256(w.sum) + amount;
        if (total > limit) return (false, total);

        uint256 idx = uint256(w.lastHour) % RING;
        _set(w, idx, (uint256(_get(w, idx)) + amount).toUint64());
        w.sum = total.toUint64();
        return (true, total);
    }

    /// @dev Moves the window to `hour_`, zeroing the buckets that fall out of it.
    function _advance(Window storage w, uint256 hour_) private {
        uint256 last = w.lastHour;
        if (hour_ <= last) return;

        if (w.sum != 0) {
            uint256 total = w.sum;
            uint256 steps = hour_ - last;
            if (steps > LOOKBACK + 1) steps = LOOKBACK + 1;
            for (uint256 i; i < steps; ++i) {
                uint256 idx = (last + 8 + i) % RING;
                uint64 bucket = _get(w, idx);
                if (bucket != 0) {
                    total -= bucket;
                    _set(w, idx, 0);
                }
            }
            w.sum = total.toUint64();
        }
        w.lastHour = hour_.toUint40();
    }

    function _get(Window storage w, uint256 idx) private view returns (uint64) {
        return uint64(w.ring[idx / 4] >> ((idx % 4) * 64));
    }

    function _set(Window storage w, uint256 idx, uint64 value) private {
        uint256 shift = (idx % 4) * 64;
        uint256 word = w.ring[idx / 4];
        w.ring[idx / 4] = (word & ~(uint256(type(uint64).max) << shift)) | (uint256(value) << shift);
    }
}
