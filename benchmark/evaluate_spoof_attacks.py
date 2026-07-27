#!/usr/bin/env python3
"""APCER/BPCER by attack, condition, demographic. Use labelled real captures."""
import argparse, csv, json
from collections import defaultdict
from pathlib import Path
import cv2
from ai_edge_litert.interpreter import Interpreter
from run_antispoof import TFLITE, SCALE, SIZE, LIVE_IDX, crop_scaled, detect_box, softmax

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--manifest", required=True)
    p.add_argument("--out", default="benchmark/results/spoof_metrics.json")
    p.add_argument("--threshold", type=float, default=.35)
    a = p.parse_args()
    manifest = Path(a.manifest)
    it = Interpreter(model_path=TFLITE); it.allocate_tensors()
    inp, out = it.get_input_details()[0], it.get_output_details()[0]
    rows = []
    with manifest.open(newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["label"] not in ("live", "attack"): raise ValueError("label: live|attack")
            path = Path(r["path"]); path = path if path.is_absolute() else manifest.parent / path
            img = cv2.imread(str(path)); box = detect_box(img) if img is not None else None
            r.update(path=str(path), detected=box is not None, live_score=None, prediction="no_face")
            if box is not None:
                it.set_tensor(inp["index"], crop_scaled(img, box, SCALE)[None].astype("float32")); it.invoke()
                score = float(softmax(it.get_tensor(out["index"]).flatten())[LIVE_IDX])
                r.update(live_score=score, prediction="live" if score >= a.threshold else "attack")
            rows.append(r)
    def metrics(rs):
        live, attack = [r for r in rs if r["label"] == "live"], [r for r in rs if r["label"] == "attack"]
        return {"samples": len(rs), "BPCER_live_rejected": sum(r["prediction"] == "attack" for r in live)/len(live) if live else None,
                "APCER_attack_accepted": sum(r["prediction"] == "live" for r in attack)/len(attack) if attack else None,
                "face_detection_failures": sum(not r["detected"] for r in rs)}
    groups = {k: defaultdict(list) for k in ("attack_type", "condition", "demographic")}
    for r in rows:
        for k in groups: groups[k][r[k]].append(r)
    report = {"threshold": a.threshold, "overall": metrics(rows),
              **{f"by_{k}": {x: metrics(v) for x,v in g.items()} for k,g in groups.items()}, "samples": rows}
    out_path = Path(a.out); out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2)); print(json.dumps(report["overall"], indent=2))
if __name__ == "__main__": main()
