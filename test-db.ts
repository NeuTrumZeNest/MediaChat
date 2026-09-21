import { db } from "./src/prisma/db";

async function main() {
  const users = await db.orm.public.User.all();

  console.log("Пользователи:", users);
}

main().catch((error) => {
  console.error("Ошибка базы данных:", error);
  process.exit(1);
});