import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormLogin } from "./form-login";

export const metadata: Metadata = { title: "Ingresar · Cierre & Reparto" };

const ERRORES: Record<string, string> = {
  "sin-permiso": "Tu usuario no tiene acceso a la app.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  const errorInicial = typeof error === "string" ? ERRORES[error] : undefined;

  return (
    <main className="flex flex-1 items-center justify-center bg-surface p-margin">
      <Card className="w-full max-w-sm rounded-lg">
        <CardHeader>
          <CardTitle className="text-headline-lg">Cierre &amp; Reparto</CardTitle>
          <CardDescription className="text-body-md text-on-surface-variant">
            Ingresá con tu mail y contraseña.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormLogin errorInicial={errorInicial} />
        </CardContent>
      </Card>
    </main>
  );
}
