"""System tray icon built on pystray."""

from collections.abc import Callable
from typing import Any

from loguru import logger

from vorath_desk.runtime import IDLE, LISTENING, PAUSED, SPEAKING, THINKING, Toggles

_COLOURS = {
    IDLE: (110, 110, 130),
    LISTENING: (220, 50, 60),
    THINKING: (235, 170, 40),
    SPEAKING: (60, 190, 110),
    PAUSED: (60, 60, 70),
}


def status_image(status: str) -> Any:
    """Draw the 64px tray icon for a status."""
    from PIL import Image, ImageDraw

    image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse((4, 4, 60, 60), fill=_COLOURS.get(status, _COLOURS[IDLE]) + (255,))
    draw.text((25, 22), "V", fill=(255, 255, 255, 255))
    return image


class PystrayTray:
    """Tray icon with Mute alerts, Pause, Open Aeon and Quit."""

    def __init__(
        self,
        toggles: Toggles,
        on_toggle: Callable[[], None],
        on_open: Callable[[], None],
        on_quit: Callable[[], None],
    ) -> None:
        self._toggles = toggles
        self._on_toggle = on_toggle
        self._on_open = on_open
        self._on_quit = on_quit
        self._status = IDLE
        self._icon: Any = None

    def run(self, on_ready: Callable[[], None]) -> None:
        """Show the icon and block on the tray loop."""
        import pystray

        menu = pystray.Menu(
            pystray.MenuItem(lambda _item: f"Vorath: {self._status}", None, enabled=False),
            pystray.MenuItem("Mute alerts", self._toggle_mute, checked=lambda _item: self._toggles.muted),
            pystray.MenuItem("Pause", self._toggle_pause, checked=lambda _item: self._toggles.paused),
            pystray.MenuItem("Open Aeon", lambda _icon, _item: self._on_open()),
            pystray.MenuItem("Quit", lambda _icon, _item: self._on_quit()),
        )
        self._icon = pystray.Icon("vorath-desk", status_image(IDLE), "Vorath: idle", menu)

        def setup(icon: Any) -> None:
            icon.visible = True
            on_ready()

        self._icon.run(setup=setup)

    def show_status(self, status: str) -> None:
        """Recolour the icon and update the tooltip."""
        self._status = status
        if self._icon is None:
            return
        self._icon.icon = status_image(status)
        self._icon.title = f"Vorath: {status}"
        self._icon.update_menu()

    def stop(self) -> None:
        """Remove the icon."""
        if self._icon is not None:
            self._icon.stop()

    def _toggle_mute(self, _icon: Any, _item: Any) -> None:
        self._toggles.muted = not self._toggles.muted
        logger.info("Alerts {}", "muted" if self._toggles.muted else "unmuted")
        self._on_toggle()

    def _toggle_pause(self, _icon: Any, _item: Any) -> None:
        self._toggles.paused = not self._toggles.paused
        logger.info("Desk {}", "paused" if self._toggles.paused else "resumed")
        self._on_toggle()
