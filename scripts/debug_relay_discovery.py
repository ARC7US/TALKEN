"""Debug: trace why _sync_events returns 0 operators despite events on chain."""
import sys
sys.path.insert(0, '/root/.hermes/plugins/talken')
from tools import _get_client, _get_current_block, _query_events_batch, _apply_events, _operator_states, ARBITRUM_RPCS

client = _get_client()
print('Client created:', type(client))

block = _get_current_block(client)
print('Current block:', block)

from_block = max(0, block - 5_000_000)
print('From block:', from_block)

for rpc in ARBITRUM_RPCS:
    try:
        reg, rem = _query_events_batch(client, rpc, from_block, block)
        print(f'RPC {rpc[:50]}: registered={len(reg)}, removed={len(rem)}')
        if reg:
            print(f'  reg event: block={int(reg[0].get("blockNumber","0x0"),16)}, topics={[t[:20] for t in reg[0].get("topics",[])]}')
        print(f'  Calling _apply_events(registered)...')
        _apply_events(reg, 'registered')
        print(f'  _operator_states after: {len(_operator_states)} entries')
        for o, s in _operator_states.items():
            print(f'    {o}: {s}')
        break
    except Exception as e:
        print(f'RPC {rpc[:50]} FAILED: {type(e).__name__}: {e}')
