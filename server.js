import "dotenv/config";

import { createServer } from "http";
import next from "next";
import { Server } from "socket.io";
import { jwtVerify } from "jose";
import { stat } from "node:fs/promises";
import { join } from "node:path";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = 3000;

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

      socket.on("chat-message", async (incoming, acknowledge) => {
        const reply = (result) => {
          if (typeof acknowledge === "function") {
            acknowledge(result);
          }
        };

        try {
          const text =
            typeof incoming?.text === "string"
              ? incoming.text.trim()
              : "";

          const imageUrl =
            typeof incoming?.imageUrl === "string"
              ? incoming.imageUrl
              : null;

          if (!text && !imageUrl) {
            reply({ ok: false, error: "Пустое сообщение" });
            return;
          }

          if (text.length > 4000) {
            reply({ ok: false, error: "Слишком длинное сообщение" });
            return;
          }

          if (imageUrl) {
            const match = imageUrl.match(
              /^\/api\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|webp|gif))$/
            );

            if (!match) {
              reply({ ok: false, error: "Недопустимый адрес изображения" });
              return;
            }

            try {
              const file = await stat(
                join(process.cwd(), "uploads", match[1])
              );

              if (!file.isFile() || file.size > 10 * 1024 * 1024) {
                throw new Error("Недопустимый файл");
              }
            } catch {
              reply({ ok: false, error: "Изображение не найдено" });
              return;
            }
          }

          const savedMessage = await db.orm.public.Message.create({
            text,
            imageUrl,
            userId: user.id,
          });

          const outgoingMessage = {
            id: savedMessage.id,
            author: user.username,
            userId: user.id,
            text: savedMessage.text,
            imageUrl: savedMessage.imageUrl,
            createdAt: savedMessage.createdAt.toString(),
          };

          socket.broadcast.emit("chat-message", outgoingMessage);

          reply({
            ok: true,
            message: outgoingMessage,
          });
        } catch (error) {
          console.error("Ошибка сохранения сообщения:", error);

          reply({
            ok: false,
            error: "Не удалось сохранить сообщение",
          });
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
