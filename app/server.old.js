import "dotenv/config";

import { createServer } from "http";
import next from "next";
import { Server } from "socket.io";
import { jwtVerify } from "jose";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT) || 3000;

const app = next({
  dev,
  hostname,
  port,
});

const handle = app.getRequestHandler();

function getCookie(cookieHeader, name) {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";");

  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.trim().split("=");

    if (key === name) {
      return decodeURIComponent(valueParts.join("="));
    }
  }

  return null;
}

app
  .prepare()
  .then(async () => {
    const { db } = await import("./src/prisma/db.ts");

    const secret = process.env.SESSION_SECRET;

    if (!secret) {
      throw new Error("SESSION_SECRET не задан");
    }

    const sessionSecret = new TextEncoder().encode(secret);

    console.log("База данных подключена");

    const httpServer = createServer((req, res) => {
      handle(req, res);
    });

    const io = new Server(httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
      transports: ["polling", "websocket"],
    });

    // Проверяем сессию ДО подключения пользователя к Socket.IO
    io.use(async (socket, next) => {
      try {
        const cookieHeader = socket.handshake.headers.cookie;

        const token = getCookie(
          cookieHeader,
          "mediachat_session"
        );

        if (!token) {
          return next(
            new Error("Необходимо войти в аккаунт")
          );
        }

        const { payload } = await jwtVerify(
          token,
          sessionSecret
        );

        const userId = Number(payload.userId);

        if (!Number.isInteger(userId) || userId <= 0) {
          return next(
            new Error("Недействительная сессия")
          );
        }

        const user = await db.orm.public.User
          .where({ id: userId })
          .first();

        if (!user) {
          return next(
            new Error("Пользователь не найден")
          );
        }

        socket.data.user = {
          id: user.id,
          username: user.username,
        };

        next();
      } catch (error) {
        console.error(
          "Ошибка авторизации Socket.IO:",
          error
        );

        next(
          new Error("Недействительная или истёкшая сессия")
        );
      }
    });

    io.on("connection", (socket) => {
      const user = socket.data.user;

      console.log(
        `Пользователь подключился: ${user.username} (id: ${user.id})`
      );

      socket.on("chat-message", async (message) => {
        try {
          const text = String(
            message?.text ?? ""
          ).trim();

          if (!text) {
            return;
          }

          const savedMessage =
            await db.orm.public.Message.create({
              text,
              userId: user.id,
            });

          console.log(
            `Сообщение сохранено. id: ${savedMessage.id}, пользователь: ${user.username}`
          );

          const outgoingMessage = {
            id: savedMessage.id,
            author: user.username,
            userId: user.id,
            text: savedMessage.text,
            createdAt: savedMessage.createdAt.toString(),
          };

          socket.broadcast.emit(
            "chat-message",
            outgoingMessage
          );
        } catch (error) {
          console.error(
            "Ошибка сохранения сообщения:",
            error
          );
        }
      });

      socket.on("disconnect", () => {
        console.log(
          `Пользователь отключился: ${user.username}`
        );
      });
    });

    httpServer.listen(port, hostname, () => {
      console.log(
        `MediaChat: http://localhost:${port}`
      );
    });
  })
  .catch((error) => {
    console.error(
      "Не удалось запустить MediaChat:",
      error
    );

    process.exit(1);
  });