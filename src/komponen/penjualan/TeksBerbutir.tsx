import { uraiTeksBerbutir, type BarisTeks, type PotonganTeks } from "@/lib/teksBerbutir";

/*
 * Teks berbutir (deskripsi baris, catatan, syarat) sebagai paragraf dan daftar (D2 §6.3, §7.2). Isinya dirender
 * sebagai teks React biasa, tanpa dangerouslySetInnerHTML, jadi markup di teks pengguna tidak pernah dijalankan.
 */

function Isi({ isi }: { isi: PotonganTeks[] }) {
  return (
    <>
      {isi.map((p, i) => (p.tebal ? <strong key={i} className="font-semibold text-slate-900">{p.teks}</strong> : <span key={i}>{p.teks}</span>))}
    </>
  );
}

type Blok = { jenis: "paragraf"; isi: PotonganTeks[] } | { jenis: "daftar"; butir: { isi: PotonganTeks[]; sub: PotonganTeks[][] }[] };

/** Butir berurutan menjadi satu daftar; sub-butir menempel ke butir sebelumnya (atau butir kosong bila tidak ada). */
function kelompokkan(baris: BarisTeks[]): Blok[] {
  const hasil: Blok[] = [];
  for (const b of baris) {
    if (b.jenis === "paragraf") {
      hasil.push({ jenis: "paragraf", isi: b.isi });
      continue;
    }
    let daftar = hasil[hasil.length - 1];
    if (!daftar || daftar.jenis !== "daftar") {
      daftar = { jenis: "daftar", butir: [] };
      hasil.push(daftar);
    }
    if (b.jenis === "butir") daftar.butir.push({ isi: b.isi, sub: [] });
    else {
      if (daftar.butir.length === 0) daftar.butir.push({ isi: [], sub: [] });
      daftar.butir[daftar.butir.length - 1].sub.push(b.isi);
    }
  }
  return hasil;
}

export default function TeksBerbutir({ teks, className = "" }: { teks: string | null | undefined; className?: string }) {
  const blok = kelompokkan(uraiTeksBerbutir(teks));
  if (blok.length === 0) return null;
  return (
    <div className={`space-y-1 text-sm text-slate-700 ${className}`}>
      {blok.map((b, i) =>
        b.jenis === "paragraf" ? (
          <p key={i}>
            <Isi isi={b.isi} />
          </p>
        ) : (
          <ul key={i} className="list-disc pl-5 space-y-0.5">
            {b.butir.map((butir, j) => (
              <li key={j} className={butir.isi.length === 0 ? "list-none" : undefined}>
                <Isi isi={butir.isi} />
                {butir.sub.length > 0 && (
                  <ul className="list-[circle] pl-5 space-y-0.5">
                    {butir.sub.map((s, k) => (
                      <li key={k}>
                        <Isi isi={s} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
