"""Step 50 - the codelab's coding tools as a remote MCP server for the eval runner.

Five tools rooted at one project directory: `read_file`, `list_dir`,
`write_file`, `str_replace` and `bash`. Every path is resolved under the
project root and a path that escapes it is an error string, as in stage 5.
The two readers carry `readOnlyHint`; the three writers carry
`destructiveHint`. TrueForge reads those annotations to decide which calls
need approval. The server speaks streamable HTTP so the TrueForge server can
reach it over the network, and it can run in a thread of the calling process
(`ToolsServer`) or as a program (`python tools_server.py --project DIR`).
"""

from __future__ import annotations

import argparse
import shutil
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

DEFAULT_PORT = 8932
BASH_TIMEOUT = 120
MAX_OUTPUT = 20_000
BASH = shutil.which("bash")  # Git Bash on Windows, /bin/bash elsewhere; None falls back to the OS shell


def resolve(project: Path, path: str) -> Path:
    """The absolute path for `path` inside `project`; raises ValueError when it escapes."""
    target = (project / path).resolve() if not Path(path).is_absolute() else Path(path).resolve()
    if target != project and project not in target.parents:
        raise ValueError(f"{path} is outside the project root")
    return target


def build_server(project: Path, host: str = "127.0.0.1", port: int = DEFAULT_PORT):
    """A FastMCP server whose five tools work on `project`."""
    try:  # mcp 1.x
        from mcp.server.fastmcp import FastMCP
    except ModuleNotFoundError:  # mcp 2.x renamed it
        from mcp.server.mcpserver import MCPServer as FastMCP
    from mcp.types import ToolAnnotations

    project = Path(project).resolve()
    server = FastMCP("s50-tools", host=host, port=port, log_level="WARNING", stateless_http=True)
    read_only = ToolAnnotations(readOnlyHint=True, destructiveHint=False)
    destructive = ToolAnnotations(readOnlyHint=False, destructiveHint=True)

    @server.tool(annotations=read_only, structured_output=False)
    def read_file(path: str) -> str:
        """Read a text file and return its contents. Paths are relative to the project root."""
        try:
            return resolve(project, path).read_text(encoding="utf-8")
        except (OSError, ValueError, UnicodeDecodeError) as failed:
            return f"Error: {failed}"

    @server.tool(annotations=read_only, structured_output=False)
    def list_dir(path: str = ".") -> str:
        """List the entries of a directory, one per line, directories with a trailing slash."""
        try:
            entries = sorted(resolve(project, path).iterdir(), key=lambda p: p.name)
        except (OSError, ValueError) as failed:
            return f"Error: {failed}"
        return "\n".join(e.name + ("/" if e.is_dir() else "") for e in entries) or "(empty)"

    @server.tool(annotations=destructive, structured_output=False)
    def write_file(path: str, content: str) -> str:
        """Create a text file, or overwrite it if it already exists."""
        try:
            target = resolve(project, path)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
        except (OSError, ValueError) as failed:
            return f"Error: {failed}"
        return f"Wrote {path}"

    @server.tool(annotations=destructive, structured_output=False)
    def str_replace(path: str, old_str: str, new_str: str) -> str:
        """Swap exact text in a file. old_str must match exactly once."""
        try:
            target = resolve(project, path)
            text = target.read_text(encoding="utf-8")
        except (OSError, ValueError) as failed:
            return f"Error: {failed}"
        count = text.count(old_str)
        if count == 0:
            return f"Error: old_str was not found in {path}"
        if count > 1:
            return f"Error: old_str matched {count} times in {path}; include more context"
        target.write_text(text.replace(old_str, new_str, 1), encoding="utf-8")
        return f"Replaced 1 match in {path}"

    @server.tool(annotations=destructive, structured_output=False)
    def bash(command: str) -> str:
        """Run a bash command in the project root and return its combined stdout and stderr."""
        try:
            completed = subprocess.run(
                [BASH, "-c", command] if BASH else command, shell=not BASH, cwd=project,
                stdin=subprocess.DEVNULL,  # a pipe stdin makes rg and friends read it instead of the tree
                capture_output=True, text=True, timeout=BASH_TIMEOUT,
            )
        except subprocess.TimeoutExpired:
            return f"Error: command took more than {BASH_TIMEOUT}s"
        output = (completed.stdout + completed.stderr).strip() or "(no output)"
        if len(output) > MAX_OUTPUT:
            output = output[:MAX_OUTPUT] + f"\n... ({len(output) - MAX_OUTPUT} more characters)"
        return f"{output}\n(exit code {completed.returncode})"

    return server


def free_port() -> int:
    """A TCP port nothing is listening on right now."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def wait_for_port(host: str, port: int, timeout: float = 15.0) -> None:
    """Block until something accepts connections on host:port, or raise TimeoutError."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return
        except OSError:
            time.sleep(0.1)
    raise TimeoutError(f"nothing is listening on {host}:{port}")


class ToolsServer:
    """The tools server on a thread of this process: `start()`, use `url`, `stop()`."""

    def __init__(self, project: Path, host: str = "127.0.0.1", port: int = DEFAULT_PORT):
        self.project = Path(project).resolve()
        self.host, self.port = host, port
        self.url = f"http://localhost:{port}/mcp"
        self._server = None
        self._thread = None

    def start(self) -> "ToolsServer":
        import uvicorn

        app = build_server(self.project, self.host, self.port).streamable_http_app()
        self._server = uvicorn.Server(uvicorn.Config(app, host=self.host, port=self.port, log_level="warning"))
        self._thread = threading.Thread(target=self._server.run, name=f"s50-tools:{self.port}", daemon=True)
        self._thread.start()
        wait_for_port("127.0.0.1", self.port)
        return self

    def stop(self) -> None:
        if self._server is not None:
            self._server.should_exit = True
            self._thread.join(timeout=10)
            self._server = self._thread = None

    def __enter__(self):
        return self.start()

    def __exit__(self, *_):
        self.stop()


def main(argv=None):
    parser = argparse.ArgumentParser(description="Serve the coding tools for one project over MCP.")
    parser.add_argument("--project", default=".", help="directory the tools may read and write")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args(argv)
    project = Path(args.project).resolve()
    print(f"s50-tools serving {project} at http://localhost:{args.port}/mcp", file=sys.stderr)
    build_server(project, args.host, args.port).run(transport="streamable-http")


if __name__ == "__main__":
    main()
