### 📜 Context for AI to Generate Cypher Queries on Dental Clinic Activity (Neo4j)

---

## 🧠 Introduction

This database models a dental clinic ecosystem, tracking **Clients, Dentists, Units (Clinics), Specialties, and Appointments**.

The system uses **Neo4j** to manage relationships between patient visits, professional schedules, and financial transactions.

---

## 📌 Database Structure

### 📍 Entities

* **Client (:Client)**

  * Represents the patient.
  * Attributes:

    * `id`
    * `name`

---

* **Dentist (:Dentist)**

  * The professional performing treatments.
  * Attributes:

    * `id`
    * `name`

---

* **Unit (:Unit)**

  * Physical clinic location.
  * Attributes:

    * `id`
    * `name`
    * `zipCode`
    * `openTime`
    * `closeTime`

---

* **Specialty (:Specialty)**

  * Dentist specialization (e.g., Orthodontics, Endodontics).
  * Attributes:

    * `id`
    * `name`

---

## 🔗 Relationships

* **(c:Client)-[:VISITED]->(u:Unit)**

  * Represents that a client visited a clinic.
  * Attributes:

    * `date`

---

* **(c:Client)-[:APPOINTMENT_WITH]->(d:Dentist)**

  * Represents a treatment/appointment.
  * Attributes:

    * `date`
    * `status` ("NOT_STARTED", "IN_PROGRESS", "COMPLETED")
    * `amount`
    * `paymentMethod` ("pix", "credit_card", "debit_card")

---

* **(d:Dentist)-[:WORKS_AT]->(u:Unit)**

  * Defines where a dentist is allowed to work.

---

* **(d:Dentist)-[:SPECIALIZED_IN]->(s:Specialty)**

  * Defines dentist expertise.

---

## ✅ Business Rules (Data Integrity Constraints)

1. **Appointment requires visit**

   * A Client can only have an appointment if they have visited the same Unit on the same date.
   * Always match `VISITED.date = APPOINTMENT_WITH.date`.

---

2. **Unique appointment per dentist per day**

   * A Client can have only one appointment with the same Dentist per date.
   * Duplicate entries must be avoided (use `MERGE` instead of `CREATE`).

---

3. **Dentist must work at the Unit**

   * A Dentist can only perform appointments at Units where they have a `WORKS_AT` relationship.

---

4. **Appointment must include payment and status**

   * Every `APPOINTMENT_WITH` must have:

     * `status`
     * `amount`
     * `paymentMethod`

---

## ⚠️ Query Guidelines for AI

IMPORTANT:

* Always connect `VISITED` and `APPOINTMENT_WITH` using the same `date`.
* Never assume a Unit without verifying a `VISITED` relationship.
* Always validate that the Dentist works at the Unit (`WORKS_AT`).
* Prefer using parameters (`$param`) instead of hardcoded values.

---

## 📌 Query Examples

### 1️⃣ Find Appointments by Client Name

```cypher
MATCH (c:Client {{name: $clientName}})-[a:APPOINTMENT_WITH]->(d:Dentist)
MATCH (c)-[v:VISITED {{date: a.date}}]->(u:Unit)
RETURN 
    c.name AS client,
    d.name AS dentist,
    u.name AS clinic,
    a.date AS date,
    a.amount AS amount,
    a.paymentMethod AS paymentMethod,
    a.status AS status
ORDER BY a.date DESC
```

---

### 2️⃣ Total Amount Spent by Client

```cypher
MATCH (c:Client)-[a:APPOINTMENT_WITH]->()
WHERE c.name CONTAINS $clientName
RETURN 
    c.name AS client,
    SUM(a.amount) AS totalSpent
```

---

### 3️⃣ Invalid Case: Appointment Without Visit

```cypher
MATCH (c:Client)-[a:APPOINTMENT_WITH]->(d:Dentist)
WHERE NOT EXISTS {{
    MATCH (c)-[:VISITED {{date: a.date}}]->(:Unit)
}}
RETURN 
    c.name AS client,
    d.name AS dentist,
    a.date AS date
```

---

### 4️⃣ Dentist Working Outside Assigned Unit

```cypher
MATCH (c:Client)-[a:APPOINTMENT_WITH]->(d:Dentist)
MATCH (c)-[:VISITED {{date: a.date}}]->(u:Unit)
WHERE NOT (d)-[:WORKS_AT]->(u)
RETURN 
    d.name AS dentist,
    u.name AS unit,
    a.date AS date,
    c.name AS client
```

---

### 5️⃣ Unfinished Treatments by Client

```cypher
MATCH (c:Client)-[a:APPOINTMENT_WITH]->(d:Dentist)
WHERE c.name CONTAINS $clientName 
  AND a.status <> "COMPLETED"
RETURN 
    c.name AS client,
    d.name AS dentist,
    a.date AS date,
    a.status AS status
```

---

### 6️⃣ Find All Appointments by Client ID

```cypher
MATCH (c:Client {{id: $clientId}})
MATCH (c)-[a:APPOINTMENT_WITH]->(d:Dentist)
MATCH (c)-[:VISITED {{date: a.date}}]->(u:Unit)
RETURN 
    c.id AS clientId,
    c.name AS client,
    d.name AS dentist,
    u.name AS clinic,
    a.date AS date,
    a.amount AS amount,
    a.status AS status,
    a.paymentMethod AS paymentMethod
ORDER BY a.date DESC
```

---

## 🚀 Example Questions for AI

### ✅ Valid Questions

* "Which clients have appointments with Dr. John?"
* "What is the total amount spent by client Maria?"
* "List all completed treatments."
* "Which unit did client Carlos visit on 2024-01-10?"

---

### ❌ Data Integrity Checks

* "Are there appointments without a corresponding visit?"
* "Is any dentist working in a unit they are not assigned to?"
* "Which clients have treatments in progress for more than 30 days?"

---

## 🎯 Summary

* Neo4j is used to model dental clinic operations.
* Relationships enforce business rules between Clients, Dentists, and Units.
* Data integrity is critical and must always be validated in queries.
* AI-generated queries must strictly follow relationship constraints and date consistency.
