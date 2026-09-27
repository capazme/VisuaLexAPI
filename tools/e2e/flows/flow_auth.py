"""F0 - identity setup: admin login + provisioning of the two run-scoped users.

Runs first; its Context (tokens + user ids) feeds every other flow. Users are
created through the admin API because /auth/register creates INACTIVE users.
Budget note: the BFF auth limiter counts non-2xx requests (5 per 15min per
IP, successful ones skipped), so this flow performs exactly one failing login.
"""
from __future__ import annotations

from e2e.context import Context
from e2e.report import Report, StepFailure

TAGS: frozenset[str] = frozenset()


def _expect(cond: bool, message: str, dump: dict | None = None) -> None:
    if not cond:
        raise StepFailure(message, dump)


async def run(ctx: Context, report: Report) -> None:
    cfg = ctx.cfg
    bff = cfg.bff
    run_id = cfg.run_id
    email_a = f"e2e-a-{run_id}@test.local"
    email_b = f"e2e-b-{run_id}@test.local"

    with report.step("admin login"):
        admin_user = await ctx.admin.login(cfg.admin_email, cfg.require_admin_password())
        _expect(admin_user.get("is_admin") is True,
                f"{cfg.admin_email} logged in but is_admin is falsy", {"user": admin_user})
        ctx.cap("admin_id", admin_user["id"])

    with report.step("provision user_a + user_b via POST /admin/users (isActive:true)"):
        user_a = await ctx.admin.admin_create_user(email_a, f"e2e-a-{run_id}", cfg.user_password)
        user_b = await ctx.admin.admin_create_user(email_b, f"e2e-b-{run_id}", cfg.user_password)
        _expect(user_a.get("is_active") is True, "user_a created but not active", {"user": user_a})
        _expect(user_b.get("is_active") is True, "user_b created but not active", {"user": user_b})
        ctx.cap("user_a_id", user_a["id"])
        ctx.cap("user_b_id", user_b["id"])

    with report.step("login user_a and user_b"):
        logged_a = await ctx.user_a.login(email_a, cfg.user_password)
        logged_b = await ctx.user_b.login(email_b, cfg.user_password)
        _expect(logged_a["id"] == user_a["id"], "user_a login returned a different user id",
                {"created": user_a, "logged": logged_a})
        _expect(logged_b["id"] == user_b["id"], "user_b login returned a different user id",
                {"created": user_b, "logged": logged_b})

    with report.step("GET /auth/me sanity (user_a)"):
        _, me = await ctx.user_a.req("GET", f"{bff}/auth/me")
        _expect(me.get("id") == ctx.user_a.user_id, "auth/me returned a different user id",
                {"me": me})
        _expect(me.get("is_active") is True, "auth/me is_active is not true", {"me": me})

    with report.step("negative: /auth/register creates an INACTIVE user -> login 403"):
        reg_email = f"e2e-reg-{run_id}@test.local"
        status, body = await ctx.user_a.req(
            "POST", f"{bff}/auth/register",
            json={"email": reg_email, "username": f"e2e-reg-{run_id}",
                  "password": cfg.user_password},
            auth=False, expect=(201, 400),
        )
        if status == 201:
            _expect(body.get("pending_approval") is True,
                    "register did not return pending_approval:true", {"body": body})
        else:
            report.note("register returned 400: run_id reuse, user already exists (still inactive)")
        # Exactly ONE intentionally-failing login (auth limiter budget).
        await ctx.user_a.req(
            "POST", f"{bff}/auth/login",
            json={"email": reg_email, "password": cfg.user_password},
            auth=False, expect=403,
        )

    with report.step("refresh token rotation (user_a)"):
        previous_token = ctx.user_a.access_token
        await ctx.user_a.refresh()
        _expect(bool(ctx.user_a.access_token), "refresh returned no access_token")
        if ctx.user_a.access_token == previous_token:
            report.note("refresh returned an identical access_token (same-second iat, acceptable)")
        _, me = await ctx.user_a.req("GET", f"{bff}/auth/me")
        _expect(me.get("id") == ctx.user_a.user_id, "auth/me failed after refresh", {"me": me})
