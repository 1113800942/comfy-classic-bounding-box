import json
import logging
import re

NODE_ID = "ClassicCreateBoundingBox"
DISPLAY_NAME = "Create Bounding Box for Notes 1.0"

_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
_MAX_PALETTE = 5


def _num(value, default=0.0) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    if v != v or v in (float("inf"), float("-inf")):
        return default
    return v


def _clamp01(v: float) -> float:
    return 0.0 if v < 0.0 else 1.0 if v > 1.0 else v


def parse_boxes(raw) -> list:
    """Parse the editor state (fractions of the image, 0..1) saved by the canvas."""
    if raw is None:
        return []
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return []
        try:
            data = json.loads(text)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{DISPLAY_NAME}: boxes_json is not valid JSON: {exc}") from exc
    else:
        data = raw
    if isinstance(data, dict):
        data = data.get("boxes", [])
    if not isinstance(data, list):
        raise ValueError(f"{DISPLAY_NAME}: boxes_json must be a list of boxes")
    return [b for b in data if isinstance(b, dict)]


def clean_palette(palette) -> list:
    if not isinstance(palette, (list, tuple)):
        return []
    out = []
    for c in palette:
        if isinstance(c, str) and _HEX.match(c.strip()):
            out.append(c.strip().upper())
        if len(out) >= _MAX_PALETTE:
            break
    return out


def to_pixel_boxes(boxes: list, width: int, height: int) -> list:
    """Convert fraction boxes into the pixel grid of the core node.

    Create Bounding Boxes turns incoming pixel boxes back into fractions by
    dividing by ITS OWN width/height widgets (pixels_to_fractions), so the
    width/height used here must be the same numbers as on that node.
    """
    width = max(1, int(width))
    height = max(1, int(height))
    out = []
    for b in boxes:
        x, y = _num(b.get("x")), _num(b.get("y"))
        w, h = _num(b.get("w")), _num(b.get("h"))
        if w < 0:
            x, w = x + w, -w
        if h < 0:
            y, h = y + h, -h
        x1, y1 = _clamp01(x), _clamp01(y)
        x2, y2 = _clamp01(x + w), _clamp01(y + h)
        if x2 <= x1 or y2 <= y1:
            continue
        px, py = round(x1 * width), round(y1 * height)
        pw = max(1, round((x2 - x1) * width))
        ph = max(1, round((y2 - y1) * height))
        etype = "text" if b.get("type") == "text" else "obj"
        out.append({
            "x": px,
            "y": py,
            "width": pw,
            "height": ph,
            "metadata": {
                "type": etype,
                "text": str(b.get("text") or "") if etype == "text" else "",
                "desc": str(b.get("desc") or ""),
                "palette": clean_palette(b.get("palette")),
            },
        })
    return out


class ClassicCreateBoundingBox:
    DESCRIPTION = (
        "Drag-draw bounding boxes in the classic (Nodes 1.0) UI. Click 'Edit boxes' on the node "
        "to open the full-screen editor: pick a color or palette, drag to create a box, then move, "
        "resize or delete it and set type (obj/text), text and description. "
        "Connect the 'bboxes' output to the optional 'bboxes' input of the core 'Create Bounding Boxes' "
        "node. Set width/height to the SAME numbers as that node: it maps the pixels back with its own "
        "width/height. If no boxes are drawn, the output is an empty list and the core node then falls "
        "back to the box stored in its own editor."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width": ("INT", {
                    "default": 720, "min": 64, "max": 16384, "step": 16,
                    "tooltip": "Pixel grid width. Must match the width of the Create Bounding Boxes node it feeds.",
                }),
                "height": ("INT", {
                    "default": 1280, "min": 64, "max": 16384, "step": 16,
                    "tooltip": "Pixel grid height. Must match the height of the Create Bounding Boxes node it feeds.",
                }),
                "boxes_json": ("STRING", {
                    "default": "[]",
                    "multiline": False,
                    "tooltip": "Boxes drawn in the editor (saved with the workflow). Edited by the canvas.",
                }),
            },
            "optional": {
                "background": ("IMAGE", {
                    "tooltip": "Optional image shown behind the boxes in the editor. Any image works.",
                }),
            },
        }

    RETURN_TYPES = ("BOUNDING_BOX",)
    RETURN_NAMES = ("bboxes",)
    OUTPUT_TOOLTIPS = ("Boxes as [{x, y, width, height, metadata}] for the bboxes input of Create Bounding Boxes.",)
    FUNCTION = "build"
    CATEGORY = "utilities"

    def build(self, width, height, boxes_json, background=None):
        boxes = to_pixel_boxes(parse_boxes(boxes_json), width, height)
        if not boxes:
            logging.warning(
                "[%s] no boxes drawn; Create Bounding Boxes will fall back to its own stored box.",
                DISPLAY_NAME,
            )
        ui = {"classic_bbox_dims": [int(width), int(height)]}
        if background is not None and len(background) > 0:
            try:
                import nodes as comfy_nodes  # ComfyUI's own nodes module
                saved = comfy_nodes.PreviewImage().save_images(background[:1], "classic_bbox.background")
                ui["classic_bbox_bg"] = saved["ui"]["images"]
            except Exception as exc:  # preview is only a convenience
                logging.warning("[%s] could not save background preview: %s", DISPLAY_NAME, exc)
        return {"ui": ui, "result": (boxes,)}


NODE_CLASS_MAPPINGS = {NODE_ID: ClassicCreateBoundingBox}
NODE_DISPLAY_NAME_MAPPINGS = {NODE_ID: DISPLAY_NAME}
