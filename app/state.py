from __future__ import annotations

import asyncio
from collections import OrderedDict, defaultdict
from contextlib import suppress
from copy import deepcopy
from typing import Any


class OracleState:
    def __init__(self, max_assets: int) -> None:
        self._max_assets = max_assets
        self._latest: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._idempotency: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def latest(self, asset_id: str) -> dict[str, Any] | None:
        async with self._lock:
            value = self._latest.get(asset_id)
            if value is not None:
                self._latest.move_to_end(asset_id)
            return deepcopy(value)

    async def idempotent_result(self, key: str) -> dict[str, Any] | None:
        async with self._lock:
            return deepcopy(self._idempotency.get(key))

    async def save(self, asset_id: str, result: dict[str, Any], idempotency_key: str | None) -> None:
        async with self._lock:
            self._latest[asset_id] = deepcopy(result)
            self._latest.move_to_end(asset_id)
            while len(self._latest) > self._max_assets:
                self._latest.popitem(last=False)
            if idempotency_key:
                self._idempotency[idempotency_key] = deepcopy(result)
                self._idempotency.move_to_end(idempotency_key)
                while len(self._idempotency) > self._max_assets * 2:
                    self._idempotency.popitem(last=False)
            subscribers = list(self._subscribers.get(asset_id, ()))
        for queue in subscribers:
            if queue.full():
                with suppress(asyncio.QueueEmpty):
                    queue.get_nowait()
            queue.put_nowait(deepcopy(result))

    async def subscribe(self, asset_id: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=1)
        async with self._lock:
            self._subscribers[asset_id].add(queue)
        return queue

    async def unsubscribe(self, asset_id: str, queue: asyncio.Queue) -> None:
        async with self._lock:
            self._subscribers[asset_id].discard(queue)
            if not self._subscribers[asset_id]:
                self._subscribers.pop(asset_id, None)
