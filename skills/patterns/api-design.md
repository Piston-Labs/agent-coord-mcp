---
cluster: [technical, patterns]
complexity: L2
ai_summary: REST and GraphQL API design principles with resource-oriented design, error standardization, pagination, and versioning best practices
dependencies: []
last_updated: 2025-12-07
tags: [api, rest, graphql, design, http, endpoints]
source: ordinary-claude-skills
---

# API Design Principles

Design REST and GraphQL APIs that prioritize developer experience, scalability, and maintainability.

## REST Architecture

### Core Principles

- **Resources are nouns** - users, orders, products (not actions)
- **HTTP methods are verbs** - GET, POST, PUT, PATCH, DELETE
- **URLs represent hierarchies** - Consistent naming conventions
- **Stateless** - Each request contains all needed information

### Resource Design

```
Collection Endpoints:
GET    /users          # List users
POST   /users          # Create user

Item Endpoints:
GET    /users/:id      # Get user
PUT    /users/:id      # Replace user
PATCH  /users/:id      # Update user
DELETE /users/:id      # Delete user

Nested Resources:
GET    /users/:id/orders      # User's orders
POST   /users/:id/orders      # Create order for user
GET    /users/:id/orders/:oid # Specific order
```

### HTTP Methods

| Method | Purpose | Idempotent | Safe |
|--------|---------|------------|------|
| GET | Retrieve resource | Yes | Yes |
| POST | Create resource | No | No |
| PUT | Replace resource | Yes | No |
| PATCH | Partial update | No | No |
| DELETE | Remove resource | Yes | No |

### Status Codes

```
2xx Success:
200 OK              # Standard success
201 Created         # Resource created
204 No Content      # Success, no body

4xx Client Error:
400 Bad Request     # Invalid input
401 Unauthorized    # Authentication required
403 Forbidden       # Not allowed
404 Not Found       # Resource doesn't exist
422 Unprocessable   # Validation failed
429 Too Many        # Rate limited

5xx Server Error:
500 Internal Error  # Unexpected error
503 Unavailable     # Service down
```

## GraphQL Architecture

### Core Principles

- **Single endpoint** - All queries go to /graphql
- **Schema-first** - Types define your domain model
- **Client specifies data** - Request exactly what you need
- **Strongly typed** - Schema validation

### Operation Types

```graphql
# Query - Read operations
query GetUser($id: ID!) {
  user(id: $id) {
    name
    email
    orders {
      id
      total
    }
  }
}

# Mutation - Write operations
mutation CreateUser($input: CreateUserInput!) {
  createUser(input: $input) {
    id
    name
  }
}

# Subscription - Real-time updates
subscription OnOrderCreated {
  orderCreated {
    id
    total
  }
}
```

### Schema Design

```graphql
type User {
  id: ID!
  name: String!
  email: String!
  orders: [Order!]!
  createdAt: DateTime!
}

input CreateUserInput {
  name: String!
  email: String!
}

type Query {
  user(id: ID!): User
  users(first: Int, after: String): UserConnection!
}

type Mutation {
  createUser(input: CreateUserInput!): User!
  updateUser(id: ID!, input: UpdateUserInput!): User!
}
```

## Error Handling

### Consistent Error Format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid email format",
    "details": [
      {
        "field": "email",
        "message": "Must be a valid email address"
      }
    ],
    "requestId": "abc-123"
  }
}
```

### Error Categories

| Category | Status | When |
|----------|--------|------|
| Validation | 400/422 | Input fails validation |
| Authentication | 401 | Not logged in |
| Authorization | 403 | Not permitted |
| Not Found | 404 | Resource doesn't exist |
| Conflict | 409 | Resource already exists |
| Server Error | 500 | Unexpected failure |

## Pagination

### REST Pagination

```
Offset-based:
GET /users?limit=20&offset=40

Cursor-based (preferred):
GET /users?limit=20&after=cursor123

Response:
{
  "data": [...],
  "pagination": {
    "total": 100,
    "hasMore": true,
    "nextCursor": "cursor143"
  }
}
```

### GraphQL Pagination (Relay)

```graphql
query Users($first: Int!, $after: String) {
  users(first: $first, after: $after) {
    edges {
      node {
        id
        name
      }
      cursor
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

## Versioning

### URL Versioning (REST)
```
/v1/users
/v2/users
```

### Header Versioning
```
Accept: application/vnd.api+json; version=2
```

### GraphQL Versioning
- Deprecate fields, don't remove
- Add new fields alongside old
- Use @deprecated directive

```graphql
type User {
  name: String! @deprecated(reason: "Use fullName instead")
  fullName: String!
}
```

## Best Practices

### Do
- [ ] Version APIs from day one
- [ ] Use consistent naming (camelCase or snake_case, not mixed)
- [ ] Document with OpenAPI/Swagger (REST) or schema (GraphQL)
- [ ] Validate input at boundary
- [ ] Use rate limiting
- [ ] Return appropriate status codes
- [ ] Include request ID in errors
- [ ] Paginate collections

### Don't
- [ ] Use verbs in URLs (POST /createUser)
- [ ] Ignore HTTP semantics (POST for reads)
- [ ] Return inconsistent error formats
- [ ] Expose internal IDs unnecessarily
- [ ] Forget pagination on collections
- [ ] Skip deprecation, just break things

## N+1 Prevention (GraphQL)

Use DataLoader to batch database queries:

```typescript
const userLoader = new DataLoader(async (ids) => {
  const users = await db.users.findMany({
    where: { id: { in: ids } }
  });
  return ids.map(id => users.find(u => u.id === id));
});

// In resolver
user: (order) => userLoader.load(order.userId)
```

## Application to Agent Coordination Hub

### Current APIs
- MCP tools follow consistent patterns
- REST endpoints in /api/
- Error responses mostly consistent

### Enhancement Ideas

1. **API documentation**
   - Auto-generate from tool definitions
   - OpenAPI spec for REST endpoints

2. **Consistent error codes**
   - Standardize error format across all tools
   - Include actionable messages

3. **Rate limiting visibility**
   - Show rate limit headers
   - Warn before hitting limits

4. **Pagination everywhere**
   - All list endpoints paginated
   - Consistent cursor format
