"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setSuccess("");

    if (password !== passwordAgain) {
      setError("Пароли не совпадают");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/register", {
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
        setError(
          data.error ?? "Не удалось зарегистрировать пользователя"
        );
        return;
      }

      setSuccess(
        `Пользователь ${data.user.username} зарегистрирован!`
      );

      setUsername("");
      setPassword("");
      setPasswordAgain("");

      setTimeout(() => {
        router.push("/login");
      }, 1000);
    } catch (error) {
      console.error("Ошибка регистрации:", error);
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
        onSubmit={register}
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
          Регистрация
        </h1>

        <input
          type="text"
          placeholder="Имя пользователя"
          value={username}
          onChange={(event) =>
            setUsername(event.target.value)
          }
          autoComplete="username"
          required
          minLength={3}
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
          onChange={(event) =>
            setPassword(event.target.value)
          }
          autoComplete="new-password"
          required
          minLength={8}
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
          placeholder="Повторите пароль"
          value={passwordAgain}
          onChange={(event) =>
            setPasswordAgain(event.target.value)
          }
          autoComplete="new-password"
          required
          minLength={8}
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
          {loading
            ? "Создание аккаунта..."
            : "Создать аккаунт"}
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

        {success && (
          <p
            style={{
              color: "#70df8a",
              textAlign: "center",
              margin: 0,
            }}
          >
            {success}
          </p>
        )}

        <p
          style={{
            textAlign: "center",
            color: "#aaa",
            margin: "6px 0 0",
          }}
        >
          Уже есть аккаунт?{" "}
          <a
            href="/login"
            style={{
              color: "white",
            }}
          >
            Войти
          </a>
        </p>
      </form>
    </main>
  );
}