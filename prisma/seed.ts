import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "../src/lib/seedDatabase";

const prisma = new PrismaClient();

seedDatabase(prisma)
  .then((result) => console.log("Seed complete:", result))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
