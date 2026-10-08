"""
MT5 Manager API gateway (Python).

A small HTTP service that the nexQ-Deposit backend calls to credit deposits to a
client's MetaTrader 5 account. It wraps the official MetaQuotes Manager API
Python package (`MT5Manager`). The MT5 connection (server / manager login /
password) is sent by the portal on each request — configured in the portal's
Settings page — so this service stores no broker secrets itself.

Endpoints (all JSON; protected by the X-Api-Key header except /health):
  GET  /health    -> { ok, service }
  POST /connect   -> { server, managerLogin, managerPassword }
                     validates the manager connection. -> { ok, message }
  POST /deposit   -> { server, managerLogin, managerPassword,
                       login, amount, currency, group?, comment, reference }
                     performs a balance deal on `login`. -> { ok, dealId, message }

Run:
  pip install -r requirements.txt
  set GATEWAY_API_KEY=dev-mt5-key      (Windows)  /  export on *nix
  python mt5_gateway.py                # listens on :4100

Notes:
  * The real `MT5Manager` package only runs on Windows and needs the native
    Manager API libraries from your broker / MetaQuotes. If it is not installed,
    this service starts in MOCK mode (set GATEWAY_MOCK=0 to force real mode and
    fail loudly instead).
  * `DealerBalance(login, balance, type, comment)` performs the balance op.
    type = MTDeal.EnDealAction.DEAL_BALANCE for a deposit (positive amount).
    Method/return shapes can vary slightly by SDK version — verify against your
    MT5Manager build and adjust _do_deposit if needed (marked below).
"""

import os
import threading
from flask import Flask, request, jsonify

API_KEY = os.environ.get("GATEWAY_API_KEY", "dev-mt5-key")
PORT = int(os.environ.get("GATEWAY_PORT", "4100"))

# Try to load the real MT5 Manager API. Fall back to mock if unavailable.
_FORCE_MOCK = os.environ.get("GATEWAY_MOCK", "").strip() in ("1", "true", "True")
try:
    if _FORCE_MOCK:
        raise ImportError("forced mock")
    import MT5Manager  # type: ignore

    REAL = True
except Exception as _e:  # noqa: BLE001
    MT5Manager = None  # type: ignore
    REAL = False
    _IMPORT_NOTE = str(_e)

app = Flask(__name__)

# One ManagerAPI per (server, login) so we don't reconnect on every call.
_managers: dict = {}
_lock = threading.Lock()
_mock_deal_seq = [70000]


def _require_key():
    if API_KEY and request.headers.get("X-Api-Key") != API_KEY:
        return jsonify(ok=False, message="invalid api key"), 401
    return None


def _get_manager(server: str, login: str, password: str):
    """Return a connected ManagerAPI, creating/caching one per (server, login)."""
    key = f"{server}|{login}"
    with _lock:
        mgr = _managers.get(key)
        if mgr is not None:
            return mgr, None

        mgr = MT5Manager.ManagerAPI()
        ok = mgr.Connect(
            server,
            int(login),
            password,
            MT5Manager.ManagerAPI.EnPumpModes.PUMP_MODE_FULL,
            30000,  # timeout ms
        )
        if not ok:
            err = MT5Manager.LastError()
            return None, f"connect failed: {err}"
        _managers[key] = mgr
        return mgr, None


def _do_deposit(mgr, login: int, amount: float, comment: str):
    """Perform the balance deal. Returns (dealId, errorMessage).

    Verify this against your MT5Manager version — DealerBalance returns the
    deal ticket on success in most builds; some return a bool + out-param.
    """
    deal = mgr.DealerBalance(
        login,
        amount,
        MT5Manager.MTDeal.EnDealAction.DEAL_BALANCE,
        comment,
    )
    if not deal:
        return None, f"DealerBalance failed: {MT5Manager.LastError()}"
    # `deal` may be the ticket (int) or an object carrying .Deal — handle both.
    deal_id = getattr(deal, "Deal", deal)
    return str(deal_id), None


@app.get("/health")
def health():
    return jsonify(ok=True, service="mt5-gateway", mode="real" if REAL else "mock")


@app.post("/connect")
def connect():
    guard = _require_key()
    if guard:
        return guard
    body = request.get_json(silent=True) or {}
    server = body.get("server")
    login = str(body.get("managerLogin") or "")
    password = body.get("managerPassword") or ""
    if not server or not login:
        return jsonify(ok=False, message="server and managerLogin required"), 400

    if not REAL:
        return jsonify(ok=True, message=f"[mock] connect to {server} OK ({_IMPORT_NOTE})")

    mgr, err = _get_manager(server, login, password)
    if err:
        return jsonify(ok=False, message=err), 502
    return jsonify(ok=True, message=f"connected to {server} as manager {login}")


@app.post("/deposit")
def deposit():
    guard = _require_key()
    if guard:
        return guard
    body = request.get_json(silent=True) or {}
    server = body.get("server")
    mlogin = str(body.get("managerLogin") or "")
    mpassword = body.get("managerPassword") or ""
    login = body.get("login")
    amount = body.get("amount")
    comment = body.get("comment") or f"Deposit {body.get('reference', '')}"

    if not server or not mlogin:
        return jsonify(ok=False, message="server and managerLogin required"), 400
    if not login or amount is None:
        return jsonify(ok=False, message="login and amount are required"), 400

    try:
        amount = float(amount)
        login = int(login)
    except (TypeError, ValueError):
        return jsonify(ok=False, message="login must be int and amount numeric"), 400
    if amount <= 0:
        return jsonify(ok=False, message="amount must be positive"), 400

    if not REAL:
        # Mirror the TS mock so the portal flow can be exercised without the DLL.
        if str(login) == "5000999":
            return jsonify(ok=False, message="account disabled (mock)"), 422
        _mock_deal_seq[0] += 1
        return jsonify(ok=True, dealId=str(_mock_deal_seq[0]), message="balance op accepted (mock)")

    mgr, err = _get_manager(server, mlogin, mpassword)
    if err:
        return jsonify(ok=False, message=err), 502

    deal_id, err = _do_deposit(mgr, login, amount, comment)
    if err:
        return jsonify(ok=False, message=err), 502
    return jsonify(ok=True, dealId=deal_id, message="balance operation accepted")


if __name__ == "__main__":
    print(f"[mt5-gateway] mode={'REAL' if REAL else 'MOCK'} listening on :{PORT}")
    app.run(host="0.0.0.0", port=PORT)
