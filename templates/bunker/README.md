# Bunker application

## Run

```sh
bun install
bun run dev
```

The starter API responds at `/hello`. Generate a module with:

```sh
bunker generate module users
```

The template uses process-local memory drivers for a quick start. Replace them
with shared Redis-backed drivers before deploying multiple instances.
