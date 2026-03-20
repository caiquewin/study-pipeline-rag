import neo4j from "neo4j-driver";
import { faker } from "@faker-js/faker";

const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);
const session = driver.session();

// 1. Definições de Domínio
const specializations = ["Ortodontia", "Implantodontia", "Odontopediatria", "Endodontia", "Estética", "Periodontia"];
const weekdays = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const treatmentStatus = ["Não Inicializado", "Em Andamento", "Completo"];

// 2. Gerar Unidades (Clinics)
const clinics = Array.from({ length: 5 }, () => ({
    id: faker.string.uuid(),
    name: `Clínica Sorriso - Unidade ${faker.location.city()}`,
    zipCode: faker.location.zipCode('#####-###'),
    openTime: "08:00",
    closeTime: "18:00",
    specialties: faker.helpers.arrayElements(specializations, { min: 2, max: 4 })
}));

// 3. Gerar Dentistas
const dentists = Array.from({ length: 10 }, () => ({
    id: faker.string.uuid(),
    name: `Dr(a). ${faker.person.fullName()}`,
    specialties: faker.helpers.arrayElements(specializations, { min: 1, max: 2 }),
    // Escala de trabalho
    schedules: Array.from({ length: 2 }, () => ({
        unitId: faker.helpers.arrayElement(clinics).id,
        day: faker.helpers.arrayElement(weekdays)
    }))
}));

// 4. Gerar Clientes e Consultas
const clients = Array.from({ length: 30 }, () => ({
    id: faker.string.uuid(),
    name: faker.person.fullName(),
    email: faker.internet.email()
}));

const appointments = clients.map(client => {
    const dentist = faker.helpers.arrayElement(dentists);
    const schedule = faker.helpers.arrayElement(dentist.schedules);
    return {
        clientId: client.id,
        clientName: client.name, // Adicionado aqui para o Cypher usar
        dentistId: dentist.id,
        clinicId: schedule.unitId,
        amount: faker.number.float({ min: 150, max: 1200, fractionDigits: 2 }),
        paymentMethod: faker.helpers.arrayElement(["pix", "credit_card", "debit_card"]),
        status: faker.helpers.arrayElement(treatmentStatus),
        date: faker.date.recent().toISOString().split('T')[0]
    };
});

async function seedClinicData() {
    try {
        // 1. Inserir Unidades e Especialidades
        await session.run(`
            UNWIND $batch AS row
            MERGE (u:Unit {id: row.id})
            SET u.name = row.name, u.zipCode = row.zipCode, 
                u.openTime = row.openTime, u.closeTime = row.closeTime
            WITH u, row
            UNWIND row.specialties AS specName
            MERGE (s:Specialty {name: specName})
            MERGE (u)-[:OFFERS]->(s)
        `, { batch: clinics });

        // 2. Inserir Dentistas, Especialidades e Escala
        await session.run(`
            UNWIND $batch AS row
            MERGE (d:Dentist {id: row.id})
            SET d.name = row.name
            WITH d, row
            UNWIND row.specialties AS specName
            MERGE (s:Specialty {name: specName})
            MERGE (d)-[:SPECIALIZED_IN]->(s)
            WITH d, row
            UNWIND row.schedules AS sched
            MATCH (u:Unit {id: sched.unitId})
            MERGE (d)-[r:WORKS_AT]->(u)
            SET r.day = sched.day
        `, { batch: dentists });

        // 3. Inserir Clientes e Relacionar Consultas (CORRIGIDO)
        await session.run(`
            UNWIND $batch AS row
            MERGE (c:Client {id: row.clientId})
            SET c.name = row.clientName
            WITH c, row
            MATCH (d:Dentist {id: row.dentistId})
            MATCH (u:Unit {id: row.clinicId})
            MERGE (c)-[v:VISITED {date: row.date}]->(u)
            MERGE (c)-[a:APPOINTMENT_WITH]->(d)
            SET a.amount = row.amount, 
                a.paymentMethod = row.paymentMethod, 
                a.status = row.status, 
                a.date = row.date
        `, { batch: appointments });

        console.log("🏥 Dados da Clínica populados com sucesso!");
    } catch (error) {
        console.error("❌ Erro ao inserir dados:", error);
    } finally {
        await session.close();
        await driver.close();
    }
}

await seedClinicData();