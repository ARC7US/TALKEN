"""Test: does _sync_events work end-to-end with updated code?"""
import sys
sys.path.insert(0, '/root/.hermes/plugins/talken')
from tools import _sync_events, _operator_states, _last_synced_block

print('_last_synced_block before:', _last_synced_block)
_sync_events()
print('_last_synced_block after:', _last_synced_block)
print('operators:', len(_operator_states))
for o, s in _operator_states.items():
    print(' ', o, s)
print('OK' if len(_operator_states) > 0 else 'FAIL')
