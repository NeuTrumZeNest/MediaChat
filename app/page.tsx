"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";

type User = {
  id: number;
  username: string;
};

type Message = {
  id: number;
  author: string;
  text: string;
  userId?: number;
  system?: boolean;
  createdAt?: string;
};

const systemMessage: Message = {
  id: -1,
  author: "System",
  text: "Добро пожаловать в ЧАТ",
  system: true,
};

function formatMessageDate(value?: string) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function Home() {
  const router = useRouter();

  const socketRef = useRef<Socket | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState("");

  const [messages, setMessages] = useState<Message[]>([
    systemMessage,
  ]);

  // 1. Проверяем, вошёл ли пользователь
  useEffect(() => {
    async function checkSession() {
      try {
        const response = await fetch("/api/me", {
          cache: "no-store",
        });

        if (!response.ok) {
          router.replace("/login");
          return;
        }

        const data = await response.json();

        setUser(data.user);
      } catch (error) {
        console.error(
          "Ошибка проверки сессии:",
          error
        );

        router.replace("/login");
      } finally {
        setCheckingSession(false);
      }
    }

    checkSession();
  }, [router]);

  // 2. После входа загружаем историю из PostgreSQL
  useEffect(() => {
    if (!user) {
      return;
    }

    async function loadMessages() {
      try {
        const response = await fetch("/api/messages", {
          cache: "no-store",
        });

        if (response.status === 401) {
          router.replace("/login");
          return;
        }

        if (!response.ok) {
          console.error(
            "Не удалось загрузить историю сообщений"
          );
          return;
        }

        const data = await response.json();

        setMessages([
          systemMessage,
          ...data.messages,
        ]);
      } catch (error) {
        console.error(
          "Ошибка загрузки истории сообщений:",
          error
        );
      }
    }

    loadMessages();
  }, [user, router]);

  // 3. После определения пользователя подключаем Socket.IO
  useEffect(() => {
    if (!user) {
      return;
    }

    const socket = io(window.location.origin, {
      transports: ["polling"],
      upgrade: false,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log(
        "Socket.IO подключён:",
        socket.id
      );

      setConnected(true);
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("connect_error", (error) => {
      console.error(
        "Ошибка Socket.IO:",
        error.message
      );

      setConnected(false);

      if (
        error.message ===
          "Необходимо войти в аккаунт" ||
        error.message ===
          "Недействительная или истёкшая сессия"
      ) {
        router.replace("/login");
      }
    });

    socket.on(
      "chat-message",
      (newMessage: Message) => {
        setMessages((oldMessages) => [
          ...oldMessages,
          newMessage,
        ]);
      }
    );

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user, router]);

  function sendMessage() {
    const socket = socketRef.current;
    const text = message.trim();

    if (
      !socket ||
      !socket.connected ||
      !user ||
      !text
    ) {
      return;
    }

    // Сразу показываем своё сообщение у себя.
    // Сервер самостоятельно определит автора по cookie.
    const localMessage: Message = {
      id: Date.now(),
      author: user.username,
      userId: user.id,
      text,
      createdAt: new Date().toISOString(),
    };

    setMessages((oldMessages) => [
      ...oldMessages,
      localMessage,
    ]);

    socket.emit("chat-message", {
      text,
    });

    setMessage("");
  }

  async function logout() {
    try {
      await fetch("/api/logout", {
        method: "POST",
      });
    } catch (error) {
      console.error(
        "Ошибка выхода:",
        error
      );
    } finally {
      socketRef.current?.disconnect();

      router.replace("/login");
      router.refresh();
    }
  }

  if (checkingSession) {
    return (
      <main
        style={{
          position: "fixed",
          inset: 0,
          background: "#0d1015",
          color: "white",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          fontFamily: "Arial, sans-serif",
        }}
      >
        Проверка сессии...
      </main>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        background: "#0d1015",
        color: "white",
        fontFamily: "Arial, sans-serif",
      }}
    >
      {/* Левая панель */}
      <aside
        style={{
          width: "250px",
          minWidth: "250px",
          background: "#171a21",
          borderRight: "1px solid #30343d",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Название */}
        <div
          style={{
            padding: "24px 20px 20px",
            fontSize: "27px",
            fontWeight: "700",
          }}
        >
          MediaChat
        </div>

        {/* Пока только реально работающий раздел */}
        <div
          style={{
            margin: "12px 8px",
            padding: "12px 14px",
            borderRadius: "11px",
            background: "#303646",
            fontWeight: "600",
            fontSize: "16px",
          }}
        >
          Общий чат
        </div>

        <div style={{ flex: 1 }} />

        {/* Профиль */}
        <div
          style={{
            borderTop: "1px solid #30343d",
            padding: "18px 14px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "11px",
            }}
          >
            <div
              style={{
                width: "44px",
                height: "44px",
                borderRadius: "50%",
                background:
                  "linear-gradient(135deg, #7657f6, #4b36bd)",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                fontWeight: "700",
                fontSize: "19px",
                flexShrink: 0,
              }}
            >
              {user.username
                .charAt(0)
                .toUpperCase()}
            </div>

            <div
              style={{
                flex: 1,
                minWidth: 0,
              }}
            >
              <div
                style={{
                  fontSize: "16px",
                  fontWeight: "700",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {user.username}
              </div>

              <div
                style={{
                  marginTop: "4px",
                  fontSize: "14px",
                  color: connected
                    ? "#5ee391"
                    : "#ff6d6d",
                }}
              >
                {connected
                  ? "В сети"
                  : "Не в сети"}
              </div>
            </div>
          </div>

          <button
            onClick={logout}
            style={{
              width: "100%",
              height: "38px",
              marginTop: "14px",
              borderRadius: "9px",
              border: "1px solid #3b404b",
              background: "#222630",
              color: "#d8d8d8",
              fontSize: "14px",
              cursor: "pointer",
            }}
          >
            Выйти
          </button>
        </div>
      </aside>

      {/* Основная область */}
      <section
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Верхняя панель */}
        <header
          style={{
            height: "76px",
            minHeight: "76px",
            borderBottom:
              "1px solid #30343d",
            background: "#15181f",
            display: "flex",
            alignItems: "center",
            padding: "0 28px",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "21px",
                fontWeight: "700",
              }}
            >
              Общий чат
            </div>

            <div
              style={{
                marginTop: "4px",
                fontSize: "14px",
                color: connected
                  ? "#949ba8"
                  : "#ff6d6d",
              }}
            >
              {connected
                ? "Соединение установлено"
                : "Нет соединения"}
            </div>
          </div>
        </header>

        {/* История сообщений */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "30px",
          }}
        >
          {messages.map((item) => {
            if (item.system) {
              return (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    justifyContent:
                      "flex-start",
                    marginBottom: "22px",
                  }}
                >
                  <div
                    style={{
                      background: "#272b36",
                      padding: "14px 18px",
                      borderRadius: "20px",
                      maxWidth: "65%",
                    }}
                  >
                    <div
                      style={{
                        color: "#ad91ff",
                        fontWeight: "700",
                        fontSize: "14px",
                        marginBottom: "8px",
                      }}
                    >
                      System
                    </div>

                    <div
                      style={{
                        fontSize: "17px",
                      }}
                    >
                      {item.text}
                    </div>
                  </div>
                </div>
              );
            }

            const isOwnMessage =
              item.userId === user.id;

            return (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  justifyContent:
                    isOwnMessage
                      ? "flex-end"
                      : "flex-start",
                  marginBottom: "22px",
                }}
              >
                <div
                  style={{
                    maxWidth: "65%",
                    background:
                      isOwnMessage
                        ? "#6753dc"
                        : "#272b36",
                    padding: "14px 18px",
                    borderRadius: "20px",
                  }}
                >
                  <div
                    style={{
                      fontWeight: "700",
                      fontSize: "14px",
                      marginBottom: "8px",
                      color: isOwnMessage
                        ? "#ffffff"
                        : "#ad91ff",
                    }}
                  >
                    {item.author}
                  </div>

                  <div
                    style={{
                      fontSize: "17px",
                      lineHeight: "1.4",
                      wordBreak: "break-word",
                    }}
                  >
                    {item.text}
                  </div>

                  {item.createdAt && (
                    <div
                      style={{
                        marginTop: "8px",
                        fontSize: "11px",
                        opacity: 0.65,
                        textAlign: "right",
                      }}
                    >
                      {formatMessageDate(item.createdAt)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Поле отправки */}
        <footer
          style={{
            borderTop:
              "1px solid #30343d",
            background: "#15181f",
            padding: "18px 20px",
            display: "flex",
            gap: "12px",
          }}
        >
          <input
            value={message}
            onChange={(event) =>
              setMessage(
                event.target.value
              )
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                sendMessage();
              }
            }}
            placeholder="Написать сообщение..."
            style={{
              flex: 1,
              height: "48px",
              padding: "0 16px",
              border:
                "1px solid #3a3f4a",
              borderRadius: "12px",
              background: "#222630",
              color: "white",
              fontSize: "16px",
              outline: "none",
            }}
          />

          <button
            onClick={sendMessage}
            disabled={!connected}
            title="Отправить"
            style={{
              width: "54px",
              height: "48px",
              border: "none",
              borderRadius: "12px",
              background: connected
                ? "#6d56ec"
                : "#343843",
              color: "white",
              fontSize: "22px",
              cursor: connected
                ? "pointer"
                : "default",
            }}
          >
            ➤
          </button>
        </footer>
      </section>
    </main>
  );
}
