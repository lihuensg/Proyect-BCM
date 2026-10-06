import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useId, useState } from "react";

import { useAppServices } from "../../app/app-services";
import { ApiError } from "../../lib/http/api-error";
import { useSessionQuery } from "../auth/use-session-query";
import {
  type MembershipRole,
  MEMBERSHIP_ROLES,
  type ProvisionedMembership,
} from "./api/memberships-contracts";
import { membershipKeys, membershipsQueryOptions } from "./memberships-queries";

const ROLE_LABELS: Readonly<Record<MembershipRole, string>> = Object.freeze({
  Owner: "Dueño",
  Admin: "Administrador",
  Seller: "Vendedor",
  Viewer: "Solo lectura",
});

const STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  Active: "Activo",
  Suspended: "Suspendido",
  Revoked: "Revocado",
});

const PROVISION_ERRORS: Readonly<Record<string, string>> = Object.freeze({
  INVALID_EMAIL: "El email no es válido.",
  ROLE_NOT_ALLOWED: "No tenés permiso para asignar ese rol.",
  MEMBERSHIP_EXISTS: "Ese email ya es miembro de la organización.",
  PROVISIONING_CONFLICT:
    "No se puede dar de alta este email. Contactá a soporte.",
  IDENTITY_PROVIDER_UNAVAILABLE:
    "No pudimos comunicarnos con el servicio de identidad. Intentá nuevamente.",
  AUTHORIZATION_DENIED: "No tenés permiso para dar de alta usuarios.",
});

function provisionErrorMessage(error: unknown): string {
  if (
    error instanceof ApiError &&
    Object.hasOwn(PROVISION_ERRORS, error.code)
  ) {
    return PROVISION_ERRORS[error.code] ?? "";
  }
  return "No pudimos dar de alta al usuario. Intentá nuevamente.";
}

function successMessage(member: ProvisionedMembership): string {
  const who = `${member.email} quedó dado de alta como ${ROLE_LABELS[member.role]}.`;
  switch (member.passwordSetupEmail) {
    case "sent":
      return `${who} Le enviamos un email para que elija su contraseña.`;
    case "failed":
      return `${who} No pudimos enviarle el email para elegir la contraseña: puede usar "¿Olvidaste tu contraseña?" al iniciar sesión.`;
    case "not-required":
      return `${who} Ya tenía una cuenta, así que puede ingresar con su contraseña actual.`;
  }
}

function ProvisionMemberForm(): ReactNode {
  const { membershipsApi } = useAppServices();
  const queryClient = useQueryClient();
  const session = useSessionQuery();
  const emailId = useId();
  const roleId = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MembershipRole>("Seller");

  const provision = useMutation({
    mutationFn: () => {
      if (session.data?.status !== "authenticated") {
        throw new Error("The Session is unavailable.");
      }
      return membershipsApi.provision(
        { email, role },
        session.data.session.csrfToken,
      );
    },
    async onSuccess() {
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: membershipKeys.all });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!provision.isPending) provision.mutate();
  }

  return (
    <form className="member-form" onSubmit={submit} noValidate>
      <h2>Dar de alta un usuario</h2>
      <div className="member-form-fields">
        <div className="form-field">
          <label htmlFor={emailId}>Email</label>
          <input
            id={emailId}
            type="email"
            autoComplete="off"
            required
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor={roleId}>Rol</label>
          <select
            id={roleId}
            value={role}
            onChange={(event) =>
              setRole(event.currentTarget.value as MembershipRole)
            }
          >
            {MEMBERSHIP_ROLES.map((option) => (
              <option key={option} value={option}>
                {ROLE_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
        <button
          className="primary-button"
          type="submit"
          disabled={provision.isPending || email.trim().length === 0}
          aria-busy={provision.isPending}
        >
          {provision.isPending ? "Dando de alta…" : "Dar de alta"}
        </button>
      </div>
      <div className="form-feedback" aria-live="polite">
        {provision.isError ? (
          <p role="alert">{provisionErrorMessage(provision.error)}</p>
        ) : null}
        {provision.isSuccess ? (
          <p className="form-success">{successMessage(provision.data)}</p>
        ) : null}
      </div>
    </form>
  );
}

function MembersList(): ReactNode {
  const { membershipsApi } = useAppServices();
  const members = useInfiniteQuery(membershipsQueryOptions(membershipsApi));

  if (members.isPending) {
    return <p aria-busy="true">Cargando usuarios…</p>;
  }
  if (members.isError) {
    return (
      <p role="alert">
        {members.error instanceof ApiError &&
        members.error.code === "AUTHORIZATION_DENIED"
          ? "No tenés permiso para ver los usuarios de la organización."
          : "No pudimos cargar los usuarios."}
      </p>
    );
  }

  const rows = members.data.pages.flatMap((page) => page.items);
  return (
    <div className="table-scroll">
      <table className="members-table">
        <caption>Usuarios de la organización</caption>
        <thead>
          <tr>
            <th scope="col">Email</th>
            <th scope="col">Rol</th>
            <th scope="col">Estado</th>
            <th scope="col">Alta</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((member) => (
            <tr key={member.id}>
              <td>{member.email}</td>
              <td>{ROLE_LABELS[member.role]}</td>
              <td>{STATUS_LABELS[member.status] ?? member.status}</td>
              <td>
                <time dateTime={member.createdAt}>
                  {new Date(member.createdAt).toLocaleDateString("es-AR")}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {members.hasNextPage ? (
        <button
          className="secondary-button"
          type="button"
          disabled={members.isFetchingNextPage}
          aria-busy={members.isFetchingNextPage}
          onClick={() => void members.fetchNextPage()}
        >
          {members.isFetchingNextPage ? "Cargando…" : "Cargar más"}
        </button>
      ) : null}
    </div>
  );
}

export function MembersPage(): ReactNode {
  return (
    <section className="members-page" aria-labelledby="members-title">
      <h1 id="members-title">Usuarios</h1>
      <p>
        Las personas que des de alta reciben un email para elegir su contraseña
        y después ingresan con “Iniciar sesión”.
      </p>
      <ProvisionMemberForm />
      <MembersList />
    </section>
  );
}
