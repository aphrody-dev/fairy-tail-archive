# Fairy Tail GraphQL

The read-only endpoint uses the reference graphql-js engine, pinned to graphql 17.0.2 (MIT). Parsing, schema validation, variable coercion, field merging, fragments, directives, introspection and execution use the installed library. No custom GraphQL parser or executor is maintained.

Public exports: schemaSDL and handleGraphQL(archive, request). The Query roots remain stats, search, episodes, media and books. Missing optional book/media catalogues return empty lists. Database initialization, crawls and ingestion never run through this endpoint. Mutations and subscriptions have no schema entry points.

GET accepts query, variables (JSON) and operationName parameters. POST accepts one application/json request object; batches are rejected. Responses use application/graphql-response+json and Cache-Control: no-store. Request/validation/coercion failures return 400; unsupported methods return 405 and unsupported request media types return 415. Executed operations return 200 even for field errors, preserving reference error paths and non-null propagation. Unexpected resolver messages are replaced by GraphQL execution failed; SQL details and private paths are not exposed.

Admission limits: request body 128 KiB (stream counted), UTF-8 source 32 KiB, parser 8192 tokens, AST nesting 128, selected field depth 24 and expanded field cost 250000. Cost conservatively expands fragments, includes skipped selections and multiplies list selections by pagination or finite schema cardinalities for introspection. The standard getIntrospectionQuery() passes these limits. Cyclic fragments are rejected by reference validation. Pagination is limited to 1..100 items with offset 0..100000; search permits 1..50 results, nonempty queries up to 2000 characters and fr/en/ja/und language filters. These are service admission policies, not alternative GraphQL semantics.

Native verification: bun test tests/graphql.test.ts, bun check packages/api-contract/graphql.ts tests/graphql.test.ts, bun lint packages/api-contract/graphql.ts tests/graphql.test.ts. The dependency license remains in the installed package and lockfile pins the exact release.
