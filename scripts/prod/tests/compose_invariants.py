"""Invariants of the rendered Compose configuration (docker compose config --format json).

Usage: compose_invariants.py <scenario> <rendered.json>

Each scenario is one combination of the files in infra/. What is asserted is what
the design promises: which module sits on which network, what is published beyond
the machine, what a container may do, and that the modules can be moved apart.
"""
import json
import re
import sys

LOOPBACK = "127.0.0.1"
STORES = {"postgres", "redis", "falkordb", "qdrant"}
MERLT = {"mcp-legal-it", "merlt-api", "merlt-worker"}
MODULES = {"migrate", "server", "ingress", "scrapers"}
APP_MODULES = {"ingress", "server", "scrapers", "migrate"}

results = {"ok": 0, "bad": 0}


def check(condition, description):
    print(("ok   " if condition else "FAIL ") + description)
    results["ok" if condition else "bad"] += 1


def networks(services, name):
    return set((services[name].get("networks") or {}).keys())


def environment(services, name):
    return services[name].get("environment") or {}


def published_hosts(services):
    return {
        name: [port.get("host_ip", "") for port in (service.get("ports") or [])]
        for name, service in services.items()
    }


def all_on_loopback(services):
    return all(ip == LOOPBACK for ips in published_hosts(services).values() for ip in ips)


def dev(cfg):
    services = cfg["services"]
    check(set(services) == STORES, "the base file alone is the four stores")
    check(set(cfg.get("networks", {})) == {"default"}, "and no network beyond the default one")
    check(all_on_loopback(services), "every published port is on the loopback")


def dev_merlt(cfg):
    services = cfg["services"]
    check(set(services) == STORES | MERLT, "the base file with the merlt profile adds MERL-T only")
    check(all_on_loopback(services), "every published port is on the loopback")


def prod(cfg, lan_bind):
    services = cfg["services"]
    check(set(services) == STORES | MERLT | MODULES, "the production set is the stores, MERL-T and the four modules")

    hosts = published_hosts(services)
    beyond = {name for name, ips in hosts.items() if any(ip != LOOPBACK for ip in ips)}
    if lan_bind:
        check(beyond == {"ingress"}, "with INGRESS_BIND set, only the ingress is published beyond the loopback")
        check(hosts["ingress"] == [lan_bind], "and it is published exactly on that address")
    else:
        check(not beyond, "by default nothing is published beyond the loopback, the ingress included")

    check(networks(services, "ingress") == {"edge", "app"}, "ingress: edge and app")
    check(networks(services, "server") == {"app", "data"}, "server: app and data")
    check(networks(services, "scrapers") == {"app"}, "scrapers: app and nothing else, so no store is reachable from them")
    check(networks(services, "migrate") == {"data"}, "migrate: data only")
    check(all(networks(services, s) == {"data"} for s in STORES), "every store: data only")
    check(networks(services, "mcp-legal-it") == {"app"}, "mcp-legal-it: app only")
    check(networks(services, "merlt-api") == {"app", "data"}, "merlt-api: app and data")
    check(networks(services, "merlt-worker") == {"app", "data"}, "merlt-worker: app and data")
    check(not any("app" in networks(services, s) for s in STORES), "no store is on the request-path network")

    subnet = ((cfg["networks"]["app"].get("ipam") or {}).get("config") or [{}])[0].get("subnet")
    check(subnet == "172.29.240.0/24", "the app network has the fixed subnet the host firewall rule is keyed on")

    check(
        all(services[s].get("restart") == "unless-stopped" for s in set(services) - {"migrate"}),
        "every long-running service restarts unless stopped",
    )
    check(services["migrate"].get("restart") == "no", "the migrate step runs once and stays down")
    check(
        all((services[s].get("logging") or {}).get("options", {}).get("max-size") for s in services),
        "every container's log is rotated",
    )
    hardened = APP_MODULES | MERLT
    check(
        all(services[s].get("cap_drop") == ["ALL"] for s in hardened),
        "the four modules and the three MERL-T containers drop every capability",
    )
    check(
        all("no-new-privileges:true" in (services[s].get("security_opt") or []) for s in hardened),
        "and cannot gain privileges",
    )
    check(all(services[s].get("init") is True for s in services), "every container has an init process to reap children")

    depends = services["server"].get("depends_on") or {}
    check(
        (depends.get("migrate") or {}).get("condition") == "service_completed_successfully",
        "the server waits for the migrations to finish successfully",
    )

    server = environment(services, "server")
    login = re.match(r"postgresql://visualex:([^@]+)@postgres:5432/visualex_platform$", server["DATABASE_URL"])
    check(bool(login), "the server's database address is derived in Compose: user, password, the postgres container")
    check(
        bool(login) and login.group(1) == environment(services, "postgres")["PLATFORM_DB_PASSWORD"],
        "and its password is the one the database was created with",
    )
    check(
        all(environment(services, "postgres")[k] for k in ("POSTGRES_PASSWORD", "PLATFORM_DB_PASSWORD", "MERLT_DB_PASSWORD")),
        "the database has its three passwords set",
    )
    check(server["NODE_ENV"] == "production", "the server runs in production mode")
    check(server["MERLT_API_URL"] == "http://merlt-api:8000", "the server reaches MERL-T by container name")
    check(server["LEGAL_API_URL"] == "http://scrapers:5000", "and the scrapers by container name")
    secrets = {
        environment(services, s)["MERLT_INTERNAL_SECRET"]
        for s in ("server", "merlt-api", "merlt-worker")
    }
    check(len(secrets) == 1 and secrets != {""}, "the server and MERL-T get the SAME internal secret, from one place")

    api = environment(services, "merlt-api")
    worker = environment(services, "merlt-worker")
    # The keys the production file does NOT override must survive the merge with the base
    # file's YAML anchor: a silent loss here would send MERL-T's jobs to the wrong place.
    check(api["RQ_REDIS_URL"] == "redis://redis:6379/1", "MERL-T's job queue address survives the merge (Redis, database 1)")
    check(api["FALKORDB_HOST"] == "falkordb" and api["QDRANT_HOST"] == "qdrant", "and its graph and vector store addresses")
    check("@postgres:5432/merlt" in api["DATABASE_URL"], "and its database")
    check(api["VISUALEX_API_URL"] == "http://scrapers:5000", "MERL-T reaches the scrapers by container name")
    check(api["BFF_QA_CALLBACK_URL"].startswith("http://server:3001/"), "MERL-T's answers call back to the server by container name")
    check(worker["BFF_CALLBACK_URL"].startswith("http://server:3001/"), "the worker's callback too")
    check(worker["BFF_EXTRACTION_CALLBACK_URL"].startswith("http://server:3001/"), "and its extraction callback")

    scrapers = services["scrapers"]
    check(environment(services, "scrapers")["TRUSTED_PROXIES"] == "1", "the scrapers trust exactly one proxy: the ingress")
    check(bool(scrapers.get("mem_limit")), "the scrapers have a memory ceiling")
    check(bool(scrapers.get("pids_limit")), "and a process ceiling")
    check(not scrapers.get("ports"), "and publish nothing")
    check(
        all(services[s].get("read_only") is True for s in ("ingress", "server", "scrapers")),
        "the ingress, the server and the scrapers have a read-only root filesystem",
    )
    check(
        all("/tmp" in (services[s].get("tmpfs") or []) for s in ("ingress", "server", "scrapers")),
        "each with a tmpfs for its scratch space",
    )

    args = (services["ingress"].get("build") or {}).get("args") or {}
    check(
        "VITE_FEATURE_MERLT" not in args and "VITE_FEATURE_MERLT_GRAPH" not in args,
        "unset MERL-T front-end flags are not passed at all (an empty string would switch them off)",
    )


def prod_lan(cfg):
    prod(cfg, "192.0.2.10")


def prod_default(cfg):
    prod(cfg, None)


def prod_flags(cfg):
    args = (cfg["services"]["ingress"].get("build") or {}).get("args") or {}
    check(args.get("VITE_FEATURE_MERLT") == "false", "a MERL-T front-end flag that IS set reaches the build as given")
    check("VITE_FEATURE_MERLT_GRAPH" not in args, "and the one that is not set still is not passed")


def no_scrapers(cfg):
    services = cfg["services"]
    check("scrapers" not in services, "without the scrapers file there is no scrapers service")
    check(environment(services, "server")["LEGAL_API_URL"] == "http://192.0.2.20:5000", "the server follows SCRAPERS_ADDR")
    check(environment(services, "ingress")["SCRAPERS_UPSTREAM"] == "192.0.2.20:5000", "the ingress follows SCRAPERS_ADDR")
    check(environment(services, "merlt-api")["VISUALEX_API_URL"] == "http://192.0.2.20:5000", "MERL-T follows it too")
    check("scrapers" not in (services["ingress"].get("depends_on") or {}), "and nothing depends on a scrapers service that may live elsewhere")


def scrapers_alone(cfg):
    services = cfg["services"]
    check(set(services) == {"scrapers"}, "the scrapers file renders by itself, with no other file")
    check(networks(services, "scrapers") == {"app"}, "on its own network")
    check(not services["scrapers"].get("ports"), "publishing nothing until the machine that runs it decides to")


SCENARIOS = {
    "dev": dev,
    "dev-merlt": dev_merlt,
    "prod-lan": prod_lan,
    "prod-default": prod_default,
    "prod-flags": prod_flags,
    "no-scrapers": no_scrapers,
    "scrapers-alone": scrapers_alone,
}

if __name__ == "__main__":
    scenario, path = sys.argv[1], sys.argv[2]
    SCENARIOS[scenario](json.load(open(path)))
    print(f"-- {scenario}: {results['ok']} ok, {results['bad']} failed")
    sys.exit(1 if results["bad"] else 0)
