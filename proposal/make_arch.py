"""Render a clean architecture/workflow diagram for the proposal."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

# palette
DARK = "#264653"; TEAL = "#2a9d8f"; SAND = "#e9c46a"; RUST = "#e76f51"
DEVICE_BG = "#eef6f5"; CLOUD_BG = "#fdf3e7"; BOX = "#ffffff"

fig, ax = plt.subplots(figsize=(8.2, 11.6))
ax.set_xlim(0, 100); ax.set_ylim(0, 150); ax.axis("off")

def box(y, h, num, title, lines, accent=TEAL, x=18, w=64, fc=BOX):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.6,rounding_size=2.2",
                                linewidth=1.6, edgecolor=accent, facecolor=fc, zorder=3))
    if num:
        ax.add_patch(plt.Circle((x + 4.5, y + h - 4.5), 3.0, color=accent, zorder=5))
        ax.text(x + 4.5, y + h - 4.5, num, ha="center", va="center",
                color="white", fontsize=11, fontweight="bold", zorder=6)
    ax.text(x + 10, y + h - 4.6, title, ha="left", va="center",
            color=DARK, fontsize=11.5, fontweight="bold", zorder=6)
    for i, ln in enumerate(lines):
        ax.text(x + 10, y + h - 9.6 - i * 3.7, ln, ha="left", va="center",
                color="#3d4a52", fontsize=8.6, zorder=6)

def arrow(y_top, y_bot, x=50, color=DARK):
    ax.add_patch(FancyArrowPatch((x, y_top), (x, y_bot), arrowstyle="-|>",
                 mutation_scale=18, linewidth=2.0, color=color, zorder=2))

# band backgrounds: device band holds camera + steps 1-6; cloud band holds step 7
ax.add_patch(FancyBboxPatch((6, 30), 88, 116, boxstyle="round,pad=0.4,rounding_size=2",
             linewidth=0, facecolor=DEVICE_BG, zorder=0))
ax.add_patch(FancyBboxPatch((6, 2), 88, 25, boxstyle="round,pad=0.4,rounding_size=2",
             linewidth=0, facecolor=CLOUD_BG, zorder=0))
ax.text(9, 143.0, "ON-DEVICE  ·  fully offline", ha="left", va="center",
        color=TEAL, fontsize=10.5, fontweight="bold")
ax.text(9, 23.8, "CLOUD  ·  only when connectivity returns", ha="left", va="center",
        color=RUST, fontsize=10.5, fontweight="bold")

# title
ax.text(50, 148.5, "Secure Offline Face Auth — On-Device Pipeline",
        ha="center", va="center", color=DARK, fontsize=14, fontweight="bold")

# steps (y grows upward; place top to bottom)
box(128, 10, "",  "Camera frame stream", ["VisionCamera frame processor, ~30 fps"], accent=DARK)
arrow(128, 125)
box(112, 13, "1", "Face Detection — ML Kit",
    ["Presence + bounding box + landmarks + classification",
     "Validity gate rejects fists / blobs (no eye/smile probs)"])
arrow(112, 109)
box(92,  17, "2", "Liveness Detection (offline)",
    ["(a) Active challenges: BLINK · SMILE · TURN HEAD L/R",
     "      from ML Kit eye-open / smile / head-yaw signals",
     "(b) Passive anti-spoof: MiniFASNetV2 (80x80) — photo/screen"],
    accent=RUST)
arrow(92, 89)
box(74,  13, "3", "Quality Gate (config.quality)",
    ["Min face size · brightness window · sharpness",
     "· head-angle limits — only clean frames pass"], accent=SAND)
arrow(74, 71)
box(57,  12, "4", "Alignment + Crop (ImageProcessor)",
    ["Eye-landmark similarity transform -> ArcFace geometry",
     "112x112 RGB, normalised (px-127.5)/127.5 -> [-1, 1]"])
arrow(57, 54)
box(42,  10, "5", "Embedding — MobileFaceNet TFLite",
    ["192-D vector · NNAPI / Core ML delegate"], accent=DARK)
arrow(42, 39)
box(31,  10, "6", "Match + Store",
    ["Cosine vs enrolled template (threshold 0.45) ->",
     "authenticated; template saved in Expo SecureStore"], accent=TEAL)
# cloud step
ax.add_patch(FancyArrowPatch((50, 31), (50, 14.5), arrowstyle="-|>",
             mutation_scale=18, linewidth=2.0, color=RUST, zorder=2))
box(2,  11, "7", "Sync & Purge",
    ["POST templates -> AWS Lambda Function URL -> DynamoDB",
     "On success, local copies are purged from the device"], accent=RUST,
    x=18, w=64, fc="#fffaf2")

plt.savefig("img/architecture.png", dpi=150, bbox_inches="tight",
            facecolor="white", pad_inches=0.25)
print("wrote img/architecture.png")
