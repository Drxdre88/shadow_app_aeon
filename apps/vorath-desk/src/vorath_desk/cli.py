"""Command-line entry point: run the tray, or say/feed in text mode."""

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from loguru import logger

from vorath_desk import __version__
from vorath_desk.commands import TextCommands
from vorath_desk.config import ConfigLoader, DeskPaths
from vorath_desk.errors import DeskError
from vorath_desk.factory import DeskFactory
from vorath_desk.keys import KeyStore
from vorath_desk.runtime import Speaker
from vorath_desk.tts import LogTTS
from vorath_desk.turn import TurnRunner


def build_parser() -> argparse.ArgumentParser:
    """The argument parser."""
    parser = argparse.ArgumentParser(prog="vorath-desk", description="Talk to Vorath from the Windows tray.")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    parser.add_argument("--home", type=Path, help="settings folder (default ~/.vorath-desk)")
    parser.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    commands = parser.add_subparsers(dest="command")
    commands.add_parser("run", help="start the tray app with push-to-talk (default)")
    say = commands.add_parser("say", help="send one typed turn and speak the reply")
    say.add_argument("text", help="what to say to Vorath")
    say.add_argument("--quiet", action="store_true", help="log the reply instead of speaking it")
    feed = commands.add_parser("feed", help="poll the alert feed")
    feed.add_argument("--once", action="store_true", required=True, help="poll once and exit")
    feed.add_argument("--quiet", action="store_true", help="log items instead of speaking them")
    return parser


def configure_logging(paths: DeskPaths, verbose: bool) -> None:
    """Log to stderr when there is a console, and always to the log file."""
    logger.remove()
    level = "DEBUG" if verbose else "INFO"
    if sys.stderr is not None:
        logger.add(sys.stderr, level=level, format="<green>{time:HH:mm:ss}</green> {level: <7} {message}")
    paths.root.mkdir(parents=True, exist_ok=True)
    logger.add(paths.log, level=level, rotation="1 MB", retention=3, encoding="utf-8")


def main(argv: Sequence[str] | None = None) -> int:
    """Run the CLI and return an exit code."""
    args = build_parser().parse_args(argv)
    paths = DeskPaths(args.home) if args.home else DeskPaths.default()
    configure_logging(paths, args.verbose)
    try:
        factory = DeskFactory(ConfigLoader().load(paths.config), paths, KeyStore(paths.root))
    except DeskError as exc:
        logger.error("{}", exc)
        return 2
    try:
        return _dispatch(args, factory)
    except DeskError as exc:
        logger.error("{}", exc)
        return 2
    except KeyboardInterrupt:
        return 130
    finally:
        factory.close()


def _dispatch(args: argparse.Namespace, factory: DeskFactory) -> int:
    if args.command == "say":
        speaker = Speaker(LogTTS() if args.quiet else factory.tts())
        return TextCommands(speaker).say(TurnRunner(factory.client(), speaker), args.text)
    if args.command == "feed":
        speaker = Speaker(LogTTS("Feed") if args.quiet else factory.tts())
        return TextCommands(speaker).feed_once(factory.feed_poller(factory.client()))
    factory.app().run()
    return 0


def tray_main() -> None:
    """Windowless entry point for the tray app."""
    sys.exit(main(["run"]))


if __name__ == "__main__":
    sys.exit(main())
