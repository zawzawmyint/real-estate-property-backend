# Avenor Properties data model

These entity-relationship diagrams describe the SQLite models in the [Prisma schema](../prisma/schema.prisma). They show every model and foreign-key relationship, with selected columns for quick scanning. The schema defines the full column list, defaults, indexes and constraints.

## Properties and CRM

```mermaid
erDiagram
    direction LR

    Property ||..o{ PropertyPhoto : has
    Property |o..o{ Lead : "linked property"
    Property ||..o{ Viewing : "scheduled property"
    User |o..o{ Lead : "assigned agent"
    User |o..o{ Lead : "creator"
    User |o..o{ LeadNote : "author"
    User |o..o{ LeadActivity : "actor"
    User |o..o{ Viewing : "creator"
    User |o..o{ Task : "creator"
    Lead ||..o{ LeadNote : has
    Lead ||..o{ LeadActivity : records
    Lead ||..o{ LeadSubmissionReceipt : has
    Lead ||..o{ Viewing : schedules
    Lead ||..o{ Task : has
    LeadNote |o..o| LeadActivity : "referenced note"
    LeadNote |o..o{ LeadSubmissionReceipt : "referenced note"

    User {
        String id PK
        String role
    }
    Property {
        String id PK
        String title
        String purpose
        BigInt priceFils "optional"
        String publishingState
        String availability
    }
    PropertyPhoto {
        String id PK
        String propertyId FK
        String storageKey UK
        Int position
    }
    Lead {
        String id PK
        String propertyId FK "optional"
        String assignedAgentId FK "optional"
        String createdById FK "optional"
        String stage
        String source
        Int version
    }
    LeadNote {
        String id PK
        String leadId FK
        String authorId FK "optional"
        String kind
    }
    LeadActivity {
        String id PK
        String leadId FK
        String actorId FK "optional"
        String noteId FK, UK "optional"
        String type
    }
    LeadSubmissionReceipt {
        String id PK "submission ID"
        String leadId FK
        String noteId FK "optional"
        String operation
    }
    Viewing {
        String id PK
        String leadId FK
        String propertyId FK
        String createdById FK "optional"
        String submissionId UK
        DateTime startsAt
        DateTime endsAt
        String status
        Int version
    }
    Task {
        String id PK
        String leadId FK
        String createdById FK "optional"
        String submissionId UK
        DateTime dueAt
        String status
        Int version
    }
```

- **Lead** links an inquiry or sales opportunity to an optional property and optional staff assignee. An unassigned lead can still have activity and notes.
- **Viewing** requires both a lead and a property. **Task** requires a lead. Staff access to both follows the lead's current assignment.
- **Photo** rows contain metadata and a storage key. The image files live on disk. A property with viewing history is protected by the viewing foreign key.
- **Submission receipts** let the leads service recognize retries. Viewings and tasks record their own submission IDs on their rows.

## Staff authentication

```mermaid
erDiagram
    direction LR

    User ||..o{ Session : has
    User ||..o{ Account : has

    User {
        String id PK
        String email UK
        String role
        Boolean disabled
        Int credentialVersion
    }
    Session {
        String id PK
        String userId FK
        DateTime expiresAt
        Int credentialVersion
    }
    Account {
        String id PK
        String userId FK
        String providerId
        String accountId
    }
    Verification {
        String id PK
        String identifier
        DateTime expiresAt
    }
```

`User` is the same staff model shown in the CRM diagram. Each session and account references one user and is deleted if that user is deleted. `Account` has a composite unique constraint on `providerId` and `accountId`. `Verification` has no foreign-key relationship in the Prisma schema.

The chatbot reads live properties from SQLite and retrieves FAQs from a separate local JSON index. See the [chatbot spec](../specs/public-property-chatbot/spec.md#software-design-at-a-glance) for that retrieval flow.
