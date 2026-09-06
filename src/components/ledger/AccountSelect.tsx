"use client";

import { useRouter } from "next/navigation";

type AccountOption = { id: string; code: string; name: string };

export default function AccountSelect({
  accounts,
  selectedId,
}: {
  accounts: AccountOption[];
  selectedId?: string;
}) {
  const router = useRouter();

  return (
    <select
      defaultValue={selectedId ?? ""}
      className="border rounded px-2 py-1 text-sm"
      onChange={(e) => router.push(`/ledger/general-ledger?accountId=${e.target.value}`)}
    >
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.code} - {a.name}
        </option>
      ))}
    </select>
  );
}
