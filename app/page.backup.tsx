"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

type Message = {
  id: number;
  author: string;
  text: string;
};

export default function Home() {
  const [message, setMessage] = useState("");
  const [connected, setConnected] = useState(false);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      author: "System",
      text: "Добро пожаловать в ЧАТ",
    },
  ]);

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
  const socket = io(window.location.origin, {
    transports: ["polling"],
    upgrade: false,
  });

  socketRef.current = socket;

  socket.on("connect", () => {
    console.log("Socket подключён:", socket.id);
    setConnected(true);
  });

  socket.on("connect_error", (error) => {
    console.error("Ошибка Socket.IO:", error.message);
    setConnected(false);
  });

  socket.on("disconnect", () => {
    console.log("Socket отключён");
    setConnected(false);
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
}, []);

  function sendMessage() {
  const socket = socketRef.current;

  if (!socket || !socket.connected) {
    console.log("Нет соединения с сервером");
    return;
  }

  const text = message.trim();

  if (!text) return;

  const newMessage: Message = {
    id: Date.now(),
    author: "Тимофей",
    text: text,
  };

  console.log("Отправляем сообщение:", newMessage);

  // СРАЗУ показываем сообщение у отправителя
  setMessages((oldMessages) => [
    ...oldMessages,
    newMessage,
  ]);

  // Отправляем на сервер для остальных пользователей
  socket.emit("chat-message", newMessage);

  setMessage("");
}

  return (
    <main className="app">
      <aside className="sidebar">
        <div className="logo">MediaChat</div>

        <nav>
          <button className="active">
            Общий чат
          </button>

          <button>
            Личные сообщения
          </button>

          <button>
            Файлы
          </button>
        </nav>

        <div className="profile">
          <div className="avatar">
            Т
          </div>

          <div>
            <strong>Тимофей</strong>

            <p>
              {connected ? "В сети" : "Подключение..."}
            </p>
          </div>
        </div>
      </aside>

      <section className="chat">
        <header className="chatHeader">
          <div>
            <h1>Общий чат</h1>

            <p>
              {connected
                ? "Соединение установлено"
                : "Нет соединения"}
            </p>
          </div>
        </header>

        <div className="messages">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={
                msg.author === "Тимофей"
                  ? "message myMessage"
                  : "message"
              }
            >
              <strong>{msg.author}</strong>
              <p>{msg.text}</p>
            </div>
          ))}
        </div>

        <div className="inputArea">
          <button className="attach">
            ＋
          </button>

          <input
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
          />

          <button
            className="send"
            onClick={sendMessage}
          >
            ➤
          </button>
        </div>
      </section>
    </main>
  );
}