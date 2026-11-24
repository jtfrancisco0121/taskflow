# 001: Phase 1 foundation choices and deviations

Date: 2026-11-24. Status: accepted.

These choices were made while building the Phase 1 foundation. Items 2 and 3 deviate from or fill gaps in `docs/architecture.md`.

1. **Maven with the wrapper.** Architecture section 3 leaves Maven or Gradle open. Maven only keeps CI and docs simple.
2. **Apps run on the host; Compose holds only infrastructure.** Architecture section 11 lists the API and a worker in Compose. There is no Dockerfile or deployment yet, so `deploy/compose.yaml` runs postgres, redis, rabbitmq, object storage and mailpit. Add app services when delivery work starts.
3. **Timestamped migration names.** Flyway files are `V<yyyyMMddHHmm>__<module>_<description>.sql` in one location, to avoid version collisions between parallel branches and to show module ownership.
4. **Committed OpenAPI contract.** `docs/api/openapi.json`, written and checked by `OpenApiContractIT`, is the only input of the frontend generator; `src/api/schema.d.ts` is committed. Builds and CI drift checks need no running backend.
5. **One HTTP client.** Frontend HTTP goes only through `src/api/client.ts` (openapi-fetch) with the Vite `/api` proxy in development. There is no env-driven API base URL and no dev CORS.
6. **Object storage image.** `minio/minio` is no longer published on Docker Hub and `quay.io/minio/minio` could not be pulled without credentials, so Compose uses `chainguard/minio` pinned by digest. It ships no `curl` or `mc`, so the healthcheck speaks HTTP through bash `/dev/tcp`. If an official image is available later, replacing it is a one-line change.
7. **Modulith fixture location.** Modulith skips `target/test-classes`, so the boundary-violation fixture (`com.taskflowfixture`) lives in `backend/src/modulith-fixture/java`, is compiled to `target/modulith-fixture-classes`, and is added to the Surefire classpath only. It never reaches the jar.
8. **TypeScript 5.9.** `openapi-typescript` 7.13.0 requires `typescript@^5`, so TypeScript is pinned to 5.9.3 instead of the newest major.
9. **Spring Boot 3.5.** The request fixes Boot 3; 3.5 is the last 3.x line, so a later move to Boot 4 is a conscious choice.
