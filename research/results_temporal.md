# Caucus choice — temporal models (conditional task)

Conditional task: among members with ≥1 new join at N+1, rank their
candidate caucuses. MRR/R@5/R@10 macro over members, averaged over the
4 test transitions (112→113 … 115→116). AUC/AP pooled, for continuity.

| model | ROC-AUC | PR-AUC | MRR | recall@5 | recall@10 |
|---|---|---|---|---|---|
| popularity (caucus size) | 0.678 | 0.079 | 0.357 | 0.077 | 0.119 |
| LR static features | 0.693 | 0.069 | 0.310 | 0.076 | 0.102 |
| LR history features only | 0.600 | 0.142 | 0.332 | 0.112 | 0.145 |
| LR static + history | 0.735 | 0.167 | 0.461 | 0.153 | 0.203 |
| GBM + history features | 0.712 | 0.106 | 0.330 | 0.082 | 0.131 |
| temporal GNN (3 seeds, mean) | 0.736 | 0.174 | 0.433 | 0.136 | 0.191 |

temporal GNN across seeds — AUC 0.736±0.006, AP 0.174±0.004, MRR 0.433±0.004

## LR + history coefficients (standardized, top 10)

```
aa             0.711
size_c         0.610
mean_nom1_c    0.581
frac_dem_c     0.570
is_dem         0.507
cn_w          -0.434
is_rep         0.433
vote_agree     0.312
pa            -0.265
std_nom1_c     0.208
```
