"""Debug script: trace relay chain discovery step by step."""
import sys, httpx, json

sys.path.insert(0, '/root/.hermes/plugins/talken')
from tools import ARBITRUM_RPCS, RELAY_REGISTRY, RELAY_REGISTERED_TOPIC, RELAY_REMOVED_TOPIC

client = httpx.Client(timeout=15)
BATCH_BLOCK_RANGE = 50000
INITIAL_SYNC_WINDOW = 5_000_000

# Step 1: get current block
block = 0
for rpc in ARBITRUM_RPCS:
    try:
        r = client.post(rpc, json={'jsonrpc': '2.0', 'method': 'eth_blockNumber', 'params': [], 'id': 1})
        block = int(r.json()['result'], 16)
        print(f'Current block: {block} via {rpc[:50]}')
        break
    except Exception as e:
        print(f'RPC fail: {rpc[:50]} - {e}')

if block == 0:
    print('FATAL: cannot reach any Arbitrum RPC')
    sys.exit(1)

# Step 2: query events
from_block = max(0, block - INITIAL_SYNC_WINDOW)
print(f'Scanning from {from_block} to {block} (range: {block - from_block})')
print(f'Contract: {RELAY_REGISTRY}')
print()

all_events = []
for rpc in ARBITRUM_RPCS:
    # Try full range first
    payload = {
        'jsonrpc': '2.0', 'method': 'eth_getLogs',
        'params': [{'address': RELAY_REGISTRY, 'topics': [[RELAY_REGISTERED_TOPIC, RELAY_REMOVED_TOPIC]],
                    'fromBlock': hex(from_block), 'toBlock': hex(block)}],
        'id': 1,
    }
    try:
        r = client.post(rpc, json=payload, timeout=30)
        data = r.json()
        if data.get('error'):
            print(f'Full range rejected by {rpc[:50]}: {data["error"]["message"][:80]}')
        else:
            all_events = data.get('result', [])
            print(f'Full range OK via {rpc[:50]}: {len(all_events)} events')
            break
    except Exception as e:
        print(f'Full range fail: {rpc[:50]} - {e}')

    # Fall through to batching
    print(f'  Batching {BATCH_BLOCK_RANGE} blocks per call...')
    batch_start = from_block
    batch_count = 0
    while batch_start < block:
        batch_end = min(batch_start + BATCH_BLOCK_RANGE - 1, block)
        try:
            payload['params'][0]['fromBlock'] = hex(batch_start)
            payload['params'][0]['toBlock'] = hex(batch_end)
            r = client.post(rpc, json=payload, timeout=15)
            data = r.json()
            if data.get('error'):
                print(f'  Batch error at {batch_start}: {data["error"]["message"][:80]}')
                break
            batch_events = data.get('result', [])
            all_events.extend(batch_events)
            batch_count += 1
            if batch_count % 10 == 0:
                print(f'  ... {batch_count} batches, {len(all_events)} events so far')
        except Exception as e:
            print(f'  Batch fail at {batch_start}: {e}')
            break
        batch_start = batch_end + 1
    print(f'  Done: {batch_count} batches, {len(all_events)} total events')
    if all_events:
        break

print()
print(f'Total events found: {len(all_events)}')
for i, e in enumerate(all_events):
    topics = e.get('topics', [])
    block_num = int(e.get('blockNumber', '0x0'), 16)
    is_registered = topics[0] == RELAY_REGISTERED_TOPIC if topics else False
    data_hex = e.get('data', '0x')
    print(f'  Event {i}: block={block_num}, type={"REGISTERED" if is_registered else "REMOVED"}')
    if len(topics) > 1:
        op = '0x' + topics[1][-40:].lower()
        print(f'    operator: {op}')
    if is_registered and len(data_hex) > 130:
        try:
            url = bytes.fromhex(data_hex[130:]).decode('utf-8').rstrip('\x00')
            print(f'    url: {url}')
        except:
            pass

print()
print('--- Running actual _sync_events() ---')
from tools import _sync_events, _operator_states, _last_synced_block
print(f'_last_synced_block before: {_last_synced_block}')
_sync_events()
print(f'_last_synced_block after: {_last_synced_block}')
print(f'Operators: {len(_operator_states)}')
for op, state in _operator_states.items():
    print(f'  {op}: {state}')
