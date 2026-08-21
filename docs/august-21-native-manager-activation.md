# August 21 native manager activation

The August 20 close produced two independently reversible paper manager
activations. Entry logic, quantity, account route, priority, admission, and
collision policy remained unchanged.

| Channel | Native for August 21 | Paired displaced control |
|---|---|---|
| `momo-shape-2` | bank half at +20%; runner to +50%; post-bank breakeven floor; -40% pre-bank catastrophe stop | all out +27% / -40% via `MOMO2-CURRENT-LOCK27` |
| `qqq-thrust-trail-wd` | all out +13% / -30% | all out +20% / -30% via `LOCK20/30` |
| `vb-macd-state` | all out +18% / -30% (already active) | all out +50% / -30% via `LOCK50/30` |

Final active manifest:

- id: `manifest:candidate:6cdc7c98-e37b-4980-89c8-b1cf3c65d57a`
- content hash: `sha256:1dfea609122650f2a0ccea395b816f49f3b95ce93da53eafc01abfeb20db3fdd`

The exact machine receipts are stored under
`data/aug21-native-manager-activation/`. Each activation pins its prior
manifest as the rollback target. The activation path had no broker order,
position, historical evidence, sizing, routing, or collision-policy authority.

The five archive collectors were independently verified already paused:
`power`, `power-smart-entries`, `momo-shape`, `breakout-smart-entries-iwm`, and
`breakout-alt-v3-qqq`. Their historical evidence remains intact and each can be
resumed only through a new chained collection-state receipt.
