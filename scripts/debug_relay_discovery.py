"""Debug script: trace why _sync_events doesn't find on-chain relay."""
import sys, httpx, json

sys.path.insert(0, '/root/.hermes/plugins/talken')
from tools import ARBITRUM_RPCS, RELAY_REGISTRY, RELAY_REGISTERED_TOPIC, RELAY_REMOVED_TOPIC

client = httpx.Client(timeout=15)

# Step 1: get current block
block = 0
for rpc in ARBITRUM_RPCS:
    try:
        r = client.post(rpc, json={'jsonrpc': '2.0', 'method': 'eth_blockNumber', 'params': [], 'id': 1})
        block = int(r.json()['result'], 16)
        print(f'Block: {block} via {rpc[:50]}')
        break
    except Exception as e:
        print(f'RPC fail: {rpc[:50]} - {e}')

if block == 0:
    print('FATAL: cannot reach any Arbitrum RPC')
    sys.exit(1)

# Step 2: query events from recent range
from_block = block - 200000
payload = {
    'jsonrpc': '2.0',
    'method': 'eth_getLogs',
    'params': [{
        'address': RELAY_REGISTRY,
        'topics': [[RELAY_REGISTERED_TOPIC, RELAY_REMOVED_TOPIC]],
        'fromBlock': hex(from_block),
        'toBlock': hex(block),
    }],
    'id': 1,
}

print(f'Querying events from {from_block} to {block} (range: {block - from_block})')
print(f'Contract: {RELAY_REGISTRY}')
print(f'Registered topic: {RELAY_REGISTERED_TOPIC}')
print(f'Removed topic: {RELAY_REMOVED_TOPIC}')
print()

for rpc in ARBITRUM_RPCS:
    try:
        r = client.post(rpc, json=payload)
        data = r.json()
        result = data.get('result', [])
        error = data.get('error', None)
        if error:
            print(f'RPC error via {rpc[:50]}: {error}')
            continue
        print(f'Events found: {len(result)} via {rpc[:50]}')
        for i, e in enumerate(result):
            topics = e.get('topics', [])
            block_num = int(e.get('blockNumber', '0x0'), 16)
            data_hex = e.get('data', '0x')
            print(f'  Event {i}:')
            print(f'    block: {block_num}')
            print(f'    topics[0]: {topics[0] if len(topics) > 0 else "N/A"}')
            print(f'    topics[1]: {topics[1] if len(topics) > 1 else "N/A"}')
            print(f'    data[:130]: {data_hex[:130]}')
            # Try to decode URL from data
            if len(data_hex) > 130:
                try:
                    url_hex = data_hex[130:]
                    url = bytes.fromhex(url_hex).decode('utf-8').rstrip('\x00')
                    print(f'    decoded URL: {url}')
                except Exception as e2:
                    print(f'    decode error: {e2}')
        print()
        break
    except Exception as e:
        print(f'Query fail via {rpc[:50]}: {e}')
        print()
else:
    print('FATAL: all RPCs failed for eth_getLogs')
    sys.exit(1)

# Step 3: Now try the actual _sync_events
print('--- Running _sync_events() ---')
from tools import _sync_events, _operator_states, _last_synced_block
print(f'_last_synced_block before: {_last_synced_block}')
_sync_events()
print(f'_last_synced_block after: {_last_synced_block}')
print(f'Operators found: {len(_operator_states)}')
for op, state in _operator_states.items():
    print(f'  {op}: {state}')

if len(_operator_states) == 0 and len(result) > 0:
    print()
    print('*** BUG: eth_getLogs returned events but _sync_events did not parse them! ***')
    print('*** Check _query_events_batch, _decode_event, and _apply_events ***')
