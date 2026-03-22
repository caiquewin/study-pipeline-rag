### **📜 Context for AI to Generate Specific Queries on Dental Clinic Activity in Neo4j**

#### **Introduction**
This database models a dental clinic ecosystem, tracking **Clinics (Units), Dentists, Specialties, and Client Appointments.**. The system uses **Neo4j**, to manage the relationships between professional schedules and patient visits.

---

### **📌 Database Structure & Rules**
The system follows strict rules to ensure data consistency and accuracy:

#### **📍 Entities & Relationships**
- **Client (:Client)**
  - Represents the patient.
  - Has attributes: `id`, `name`.

- **Dentist (:Dentist)**
  - The professional performing the procedure.
  - Has attributes: `id`, `name`.

- **Unit (:Unit)**
  - The physical clinic location.
  - Has attributes: `id`, `name` `zipCode`, `openTime`, `closeTime`.

- **Specialty (:Specialty)**
  - Medical fields (e.g., "Ortodontia", "Endodontia").
  - Relationship: `(s:Dentist)-[:SPECIALIZED_IN]->(c:Specialty)`.
  - Has attributes: `status` ("paid" or "refunded"), `paymentMethod` ("pix" or "credit_card"), `paymentDate`, `amount`.

- **Visit (:VISITED)**
  - Relationship: `(s:Client)-[:VISITED]->(c:Unit)`.
  - Has attributes: `date`.
---

### **✅ Business Rules (Data Integrity Constraints)**
1. **A client can only have an appointment with a dentist if they visit the unit.**
   - An `APPOINTMENT_WITH` relationship should ideally coexist with a `VISITED` relationship to the same `Unit` on the same `date` (though in your graph, they are separate links from the `Client`).

2. **Unique Appointments per Day/Dentist.**
   - A Client should only have one `APPOINTMENT_WITH` a specific `Dentist` per `date`. If a new entry is made for the same day, the `amount` or `status` should be updated instead of creating a duplicate relationship (this is handled by `MERGE` in your Cypher seed).

3. **A student can only purchase or refund a course once.**
   - A `Dentist` can only perform appointments at a `Unit` where they have a `WORKS_AT` relationship.
   - A `PURCHASED` relationship can only exist once per `(Student, Course)`. If a ne status is set, the existing record is updated.

4. **Payment and Status Tracking.**
   - Every `APPOINTMENT_WITH` must have a defined `status` ("Não Inicializado", "Em Andamento", "Completo") and a `paymentMethod` ("pix", "credit_card", "debit_card").

---

### **📌 Cypher Queries Mapping the Rules**

#### **1️⃣ Find Appointments by Client Name (Core Rule)
Use this pattern to find everything a specific client has done:
```cypher
MATCH (c:Client)
WHERE c.name CONTAINS "Nome do Cliente"
MATCH (c)-[a:APPOINTMENT_WITH]->(d:Dentist)
MATCH (c)-[v:VISITED {date: a.date}]->(u:Unit)
RETURN c.name AS Client, d.name AS Dentist, u.name AS Clinic, a.date AS Date, a.amount AS Price, a.status AS Status;
```

#### **2️⃣ Summary of Total Spent by Client**
```cypher
MATCH (c:Client)-[a:APPOINTMENT_WITH]->()
WHERE c.name CONTAINS "Client Name"
RETURN c.name AS Client, sum(a.amount) AS TotalSpent;
```

#### **3️⃣ Find Clients with Appointments but No Record of Visit (Invalid Case)**
```cypher
MATCH (c:Client)-[a:APPOINTMENT_WITH]->(d:Dentist)
WHERE NOT EXISTS {
    MATCH (c)-[:VISITED {date: a.date}]->(:Unit)
}
RETURN c.name AS Client, d.name AS Dentist, a.date AS Date;
```

#### **4️⃣ Find Dentists Working Outside Their Scheduled Units**
```cypher
MATCH (c:Client)-[a:APPOINTMENT_WITH]->(d:Dentist)
MATCH (c)-[:VISITED {date: a.date}]->(u:Unit)
WHERE NOT (d)-[:WORKS_AT]->(u)
RETURN d.name AS Dentist, u.name AS Unit, a.date AS Date, c.name AS Client;
```

#### **5️⃣ List All Unfinished Treatments by Client**
```cypher
MATCH (c:Client)-[a:APPOINTMENT_WITH]->(d:Dentist)
WHERE c.name CONTAINS "Client Name" AND a.status <> "Completo"
RETURN c.name, d.name, a.date, a.status;
```

---

### **🚀 AI Question Examples Based on This Context**

#### ✅ **Valid Scenarios**
1. "Which clients have appointments scheduled with Dr. [Name]?"
2. "What is the total amount spent by client '[Client Name]' on all treatments?"
3. "List all clients who have completed their treatments (status = 'Completo')."
4. "Which unit did client '[Client Name]' visit on [Date]?"

#### ❌ **Edge Cases & Invalid Data Detection**
5. "Are there any clients with an appointment record but no recorded visit to a clinic unit?"
6. "Has any dentist performed an appointment at a unit where they are not officially scheduled to work?"
7. "Which clients have 'Em Andamento' (In Progress) treatments that started more than 30 days ago?"

---

### **🎯 Summary**
- **Neo4j is used to track dental clinic activities**, including appointments, payments, and professional schedules.
- **Graph relationships enforce business rules between Clients** Dentists, and the specific Units where care is provided.
- **Data integrity constraints prevent inconsistencies**, such as appointments occurring where a dentist is not scheduled to work.
- **AI-generated questions must respect these rules** focusing on the Client name as the primary search key and correctly identifying financial data within the APPOINTMENT_WITH relationship.