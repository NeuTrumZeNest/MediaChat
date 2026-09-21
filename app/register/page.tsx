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
};

export default function Home() {
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState("");

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      author: "System",
      text: "Добро пожаловать в ЧАТ",
      system: true,
    },
  ]);

  useEffect(() => {
    async function checkSession() {
      try {
        const response = await fetch("/api/me");

        if (!response.ok) {
          router.replace("/login");
          return;
        }

        const data = await response.json();
        setUser(data.user);
      } catch (error) {
        console.error("Ошибка проверки сессии:", error);
        router.replace("/login");
      } finally {
        setCheckingSession(false);
      }
    }

    useEffect(() => {
  if (!user) {
    return;
  }

  async function loadMessages() {
    try {
      const response = await fetch("/api/messages");

      if (!response.ok) {
        console.error(
          "Не удалось загрузить историю сообщений"
        );
        return;
      }

      const data = await response.json();

      setMessages([
        {
          id: -1,
          author: "System",
          text: "Добро пожаловать в ЧАТ",
          system: true,
        },
        ...data.messages,
      ]);
    } catch (error) {
      console.error(
        "Ошибка загрузки истории:",
        error
      );
    }
  }

  loadMessages();
}, [user]);

    checkSession();
  }, [router]);

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
      console.log("Socket.IO подключён:", socket.id);
      setConnected(true);
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("connect_error", (error) => {
      console.error("Ошибка Socket.IO:", error.message);
      setConnected(false);

      if (
        error.message === "Необходимо войти в аккаунт" ||
        error.message === "Недействительная или истёкшая сессия"
      ) {
        router.replace("/login");
      }
    });

    socket.on("chat-message", (newMessage: Message) => {
      setMessages((oldMessages) => [
        ...oldMessages,
        newMessage,
      ]);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user, router]);

  function sendMessage() {
    const socket = socketRef.current;
    const text = message.trim();

    if (!socket || !socket.connected || !user || !text) {
      return;
    }

    const localMessage: Message = {
      id: Date.now(),
      author: user.username,
      userId: user.id,
      text,
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
      console.error("Ошибка выхода:", error);
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
          background: "#0f1115",
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
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
        background: "#0f1115",
        color: "white",
        fontFamily: "Arial, sans-serif",
      }}
    >
      {/* Левая панель */}
      <aside
        style={{
          width: "355px",
          minWidth: "355px",
          background: "#171a21",
          borderRight: "1px solid #30333b",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "34px",
            fontSize: "38px",
            fontWeight: "700",
          }}
        >
          MediaChat
        </div>

        {/* Пока оставляем только работающий раздел */}
        <div
          style={{
            margin: "14px 15px",
            padding: "18px 20px",
            borderRadius: "14px",
            background: "#303646",
            fontSize: "20px",
            fontWeight: "500",
          }}
        >
          Общий чат
        </div>

        <div style={{ flex: 1 }} />

        {/* Текущий пользователь */}
        <div
          style={{
            margin: "0 15px 20px",
            paddingTop: "22px",
            borderTop: "1px solid #30333b",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "14px",
            }}
          >
            <div
              style={{
                width: "52px",
                height: "52px",
                borderRadius: "50%",
                background:
                  "linear-gradient(135deg, #7c5cff, #4130aa)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "20px",
                fontWeight: "700",
              }}
            >
              {user.username.charAt(0).toUpperCase()}
            </div>

            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontWeight: "700",
                  fontSize: "19px",
                }}
              >
                {user.username}
              </div>

              <div
                style={{
                  marginTop: "5px",
                  color: connected ? "#64e69a" : "#ff7474",
                }}
              >
                {connected ? "В сети" : "Не в сети"}
              </div>
            </div>
          </div>

          <button
            onClick={logout}
            style={{
              width: "100%",
              marginTop: "18px",
              height: "42px",
              border: "1px solid #3b3f49",
              borderRadius: "10px",
              background: "#222630",
              color: "#ddd",
              fontSize: "15px",
              cursor: "pointer",
            }}
          >
            Выйти из аккаунта
          </button>
        </div>
      </aside>

      {/* Основная часть */}
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
            height: "108px",
            minHeight: "108px",
            borderBottom: "1px solid #30333b",
            display: "flex",
            alignItems: "center",
            padding: "0 38px",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "28px",
                fontWeight: "700",
              }}
            >
              Общий чат
            </div>

            <div
              style={{
                marginTop: "6px",
                fontSize: "16px",
                color: connected ? "#999faa" : "#ff7474",
              }}
            >
              {connected
                ? "Соединение установлено"
                : "Нет соединения"}
            </div>
          </div>
        </header>

        {/* Сообщения */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "40px",
          }}
        >
          {messages.map((item) => {
            if (item.system) {
              return (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    justifyContent: "flex-start",
                    marginBottom: "24px",
                  }}
                >
                  <div
                    style={{
                      background: "#272a34",
                      padding: "18px 22px",
                      borderRadius: "20px",
                    }}
                  >
                    <div
                      style={{
                        color: "#aa8cff",
                        fontWeight: "700",
                        marginBottom: "10px",
                      }}
                    >
                      {item.author}
                    </div>

                    <div
                      style={{
                        fontSize: "19px",
                      }}
                    >
                      {item.text}
                    </div>
                  </div>
                </div>
              );
            }

            const isOwnMessage = item.userId === user.id;

            return (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  justifyContent: isOwnMessage
                    ? "flex-end"
                    : "flex-start",
                  marginBottom: "24px",
                }}
              >
                <div
                  style={{
                    maxWidth: "65%",
                    background: isOwnMessage
                      ? "#6652dd"
                      : "#272a34",
                    padding: "18px 22px",
                    borderRadius: "20px",
                  }}
                >
                  <div
                    style={{
                      fontWeight: "700",
                      marginBottom: "10px",
                      color: isOwnMessage
                        ? "white"
                        : "#aa8cff",
                    }}
                  >
                    {item.author}
                  </div>

                  <div
                    style={{
                      fontSize: "19px",
                    }}
                  >
                    {item.text}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Отправка сообщения */}
        <footer
          style={{
            minHeight: "100px",
            borderTop: "1px solid #30333b",
            padding: "20px 24px",
            display: "flex",
            alignItems: "center",
            gap: "14px",
          }}
        >
          <input
            type="text"
            value={message}
            onChange={(event) =>
              setMessage(event.target.value)
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                sendMessage();
              }
            }}
            placeholder="Написать сообщение..."
            style={{
              flex: 1,
              height: "58px",
              borderRadius: "14px",
              border: "1px solid #3a3e49",
              background: "#222630",
              color: "white",
              padding: "0 20px",
              fontSize: "18px",
              outline: "none",
            }}
          />

          <button
            onClick={sendMessage}
            disabled={!connected}
            style={{
              width: "64px",
              height: "58px",
              border: "none",
              borderRadius: "14px",
              background: connected
                ? "#6c55ea"
                : "#353844",
              color: "white",
              fontSize: "25px",
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