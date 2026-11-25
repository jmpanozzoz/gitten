import errno
import fcntl
import json
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import termios
import time

master, terminal = pty.openpty()
pending = b""


def resize(columns, rows=24):
    dimensions = struct.pack("HHHH", rows, columns, 0, 0)
    fcntl.ioctl(terminal, termios.TIOCSWINSZ, dimensions)


def receive(marker):
    global pending
    deadline = time.monotonic() + 3
    while marker not in pending:
        if not select.select([master], [], [], max(0, deadline - time.monotonic()))[0]:
            raise AssertionError(f"Expected {marker!r} after {pending!r}")
        try:
            chunk = os.read(master, 4096)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            raise AssertionError(f"Terminal closed before {marker!r}") from error
        if not chunk:
            raise AssertionError(f"Terminal closed before {marker!r}")
        pending += chunk
        sys.stdout.buffer.write(chunk)
        sys.stdout.buffer.flush()
    pending = pending[pending.index(marker) + len(marker):]


def scripted(steps):
    for step in steps:
        receive(step["marker"].encode())
        if "keys" in step:
            assert not termios.tcgetattr(terminal)[3] & termios.ICANON, "Prompt must enable raw input"
            os.write(master, step["keys"].encode())


def search(scenario, child):
    receive(b"Esc cancel")
    assert not termios.tcgetattr(terminal)[3] & termios.ICANON, "Selector must enable raw input"
    if scenario == "cli":
        os.write(master, b"exit\r")
        receive(b"See you later")
    elif scenario == "multi":
        resize(52)
        child.send_signal(signal.SIGWINCH)
        receive(b"Tab toggle")
        os.write(master, "\tCafé nuevo\t\r".encode())
        receive(b'RESULT ["first","coffee"]')
    elif scenario in ("cancel", "eof"):
        os.write(master, b"\x1b" if scenario == "cancel" else b"\x04")
        receive(b"CANCELLED")
    else:
        os.write(master, "Cafe\u0301 nuevo\r".encode())
        receive(b'RESULT "coffee"')


scenario, *command = sys.argv[1:]
configuration = json.loads(command.pop(0)) if scenario == "scripted" else {}
resize(configuration.get("columns", 100), configuration.get("rows", 24))
initial = termios.tcgetattr(terminal)
with subprocess.Popen(command, stdin=terminal, stdout=terminal, stderr=terminal) as child:
    try:
        if scenario == "scripted":
            scripted(configuration["steps"])
        else:
            search(scenario, child)
        assert child.wait(timeout=3) == configuration.get("exitCode", 0)
        assert termios.tcgetattr(terminal) == initial, "Selector must restore terminal attributes"
    finally:
        if child.poll() is None:
            child.kill()
        os.close(master)
        os.close(terminal)
