# Proposal — NHAI Hackathon 7 Submission

Technical proposal for the offline facial-recognition + liveness module.

| File | What |
|---|---|
| `TechnicalProposal.pdf` | The submitted 10-page proposal (architecture, model specs, benchmarks). |
| `proposal.md` | Markdown source for the PDF. |
| `Architecture.png` | On-device pipeline diagram (also embedded in the PDF). |
| `make_arch.py` | Script that renders `Architecture.png` (matplotlib). |
| `benchmark_plots/` | ROC + score-distribution plots for LFW and the Indian set. |

All numbers match the reproducible harness in [`../benchmark`](../benchmark)
(LFW 96.75% ± 0.69%, AUC 0.982; Indian template-averaging 92.4%, AUC 0.964).

## Rebuild

```bash
# diagram (uses the benchmark venv for matplotlib)
../benchmark/.venv/bin/python make_arch.py

# PDF (no LaTeX needed): markdown -> docx -> pdf
pandoc proposal.md -o proposal.docx
soffice --headless --convert-to pdf proposal.docx

# package for upload (filename: no special chars except the extension dot)
zip -r DatalakeOfflineFaceAuthProposal.zip TechnicalProposal.pdf Architecture.png benchmark_plots
```
