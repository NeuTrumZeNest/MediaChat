"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Не удалось выполнить вход");
        return;
      }

      // Cookie уже установлена сервером.
      // Отправляем пользователя в основной чат.
      router.push("/");
      router.refresh();
    } catch (error) {
      console.error("Ошибка входа:", error);
      setError("Не удалось связаться с сервером");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#111111",
        color: "white",
      }}
    >
      <form
        onSubmit={login}
        style={{
          width: "100%",
          maxWidth: "520px",
          display: "flex",
          flexDirection: "column",
          gap: "18px",
          padding: "24px",
        }}
      >
        <h1
          style={{
            fontSize: "48px",
            fontWeight: "700",
            margin: "0 0 28px 0",
            textAlign: "center",
          }}
        >
          Вход
        </h1>

        <input
          type="text"
          placeholder="Имя пользователя"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          required
          style={{
            height: "52px",
            padding: "0 16px",
            fontSize: "20px",
            borderRadius: "8px",
            border: "1px solid #555",
          }}
        />

        <input
          type="password"
          placeholder="Пароль"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
          style={{
            height: "52px",
            padding: "0 16px",
            fontSize: "20px",
            borderRadius: "8px",
            border: "1px solid #555",
          }}
        />

        <button
          type="submit"
          disabled={loading}
          style={{
            height: "52px",
            fontSize: "20px",
            borderRadius: "8px",
            border: "none",
            cursor: loading ? "default" : "pointer",
          }}
        >
          {loading ? "Вход..." : "Войти"}
        </button>

        {error && (
          <p
            style={{
              color: "#ff7070",
              textAlign: "center",
              margin: 0,
            }}
          >
            {error}
          </p>
        )}

        <p
          style={{
            textAlign: "center",
            marginTop: "8px",
            color: "#aaa",
          }}
        >
          Нет аккаунта?{" "}
          <a
            href="/register"
            style={{
              color: "white",
            }}
          >
            Зарегистрироваться
          </a>
        </p>
      </form>
    </main>
  );
}

