"""Classic Bounding Box: a small helper node for the classic (Nodes 1.0) UI.

It lets you drag-draw boxes in a classic LiteGraph canvas and feeds them into
the optional ``bboxes`` input of the core "Create Bounding Boxes" node, so the
core node itself does not need to be changed.

The web folder is registered through pyproject.toml ([tool.comfy] web = "web"),
so the browser URL is /extensions/classic-bounding-box/ (no space). WEB_DIRECTORY
is intentionally not set here, otherwise the same script would be registered a
second time under the folder name.
"""

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
