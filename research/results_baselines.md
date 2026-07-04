# Caucus link prediction — baseline results

Train: transitions 105→106 … 111→112 (544,008 pairs, 17,799 joins)  
Test: 112→113 … 115→116 (646,336 pairs, 17,201 joins, base rate 2.66%)  
Metrics averaged over the 4 test transitions. recall@10 is macro over members with ≥1 join.

| model | ROC-AUC | PR-AUC | recall@10 |
|---|---|---|---|
| popularity (caucus size) | 0.678 | 0.079 | 0.119 |
| preferential attachment | 0.646 | 0.055 | 0.116 |
| common neighbors | 0.482 | 0.025 | 0.029 |
| adamic-adar | 0.539 | 0.028 | 0.025 |
| cosponsorship ties | 0.609 | 0.032 | 0.022 |
| vote agreement | 0.616 | 0.034 | 0.030 |
| logistic regression | 0.693 | 0.069 | 0.102 |
| hist gradient boosting | 0.673 | 0.050 | 0.068 |

## LR coefficients (standardized)

```
aa              1.034
cn_w           -0.860
size_c          0.666
mean_nom1_c     0.611
frac_dem_c      0.597
is_dem          0.495
is_rep          0.487
pa             -0.278
vote_agree      0.274
std_nom1_c      0.235
cosp_frac       0.170
growth_c       -0.143
ideo_dist      -0.120
cn_frac         0.114
cosp_w          0.083
n_caucuses_m    0.058
state_frac      0.040
age_c           0.040
nom1            0.036
nom2            0.031
party_match     0.021
seniority       0.000
```
