# Caucus link prediction — graph ML results

Same protocol as results_baselines.md: test = transitions 112→113 … 115→116,
metrics averaged over transitions. GNNs train on 105→106 … 110→111 with
early stopping on 111→112 (val AP). Seed 0, single run.

| model | ROC-AUC | PR-AUC | recall@10 |
|---|---|---|---|
| popularity (caucus size) | 0.678 | 0.079 | 0.119 |
| logistic regression (features) | 0.693 | 0.069 | 0.102 |
| svd embedding (k=32) | 0.612 | 0.047 | 0.103 |
| deepwalk (dot) | 0.526 | 0.027 | 0.023 |
| LR features + deepwalk hadamard | 0.688 | 0.068 | 0.101 |
| gnn (GraphSAGE) | 0.659 | 0.054 | 0.068 |
| gnn + pair features | 0.691 | 0.068 | 0.096 |

## Per-transition (ROC-AUC / PR-AUC)

| transition | base rate | popularity | LR | gnn+feats |
|---|---|---|---|---|
| 112→113 | 1.64% | 0.635 / 0.061 | 0.694 / 0.057 | 0.689 / 0.040 |
| 113→114 | 4.21% | 0.724 / 0.120 | 0.659 / 0.090 | 0.669 / 0.092 |
| 114→115 | 4.25% | 0.706 / 0.114 | 0.701 / 0.108 | 0.733 / 0.125 |
| 115→116 | 0.61% | 0.646 / 0.020 | 0.716 / 0.023 | 0.671 / 0.014 |

Limitations: single seed; GNN early-stops on 111→112 val AP; 
deepwalk/SVD are per-transition (no cross-congress alignment needed for scoring).
