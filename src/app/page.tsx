import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div>
            <div className="text-xl font-bold tracking-tight">
              Grandvic Tours and Travel
            </div>
            <div className="text-xs text-slate-500">
              A trading name of WINDBECK ENTERPRISES LTD
            </div>
          </div>

          <Link
            href="/login"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Client Login
          </Link>
        </div>
      </header>

      <section className="bg-slate-900">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="max-w-3xl">
            <p className="mb-5 text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">
              Grandvic Tours and Travel
            </p>

            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl">
              Travel, visa and tourism support from Kenya.
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              We assist clients with visa application support, travel
              arrangements, hotel and flight bookings, and local tourism
              experiences in Kenya.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <a
                href="mailto:grandvictoursandtravel@gmail.com"
                className="rounded-lg bg-white px-5 py-3 font-semibold text-slate-900"
              >
                Contact Us
              </a>

              <a
                href="https://wa.me/254117719426"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-slate-600 px-5 py-3 font-semibold text-white"
              >
                WhatsApp Us
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Our services
          </p>

          <h2 className="mt-3 text-3xl font-bold tracking-tight">
            Travel solutions for individuals and groups
          </h2>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[
            {
              title: "Visa Support",
              text: "Guidance and support throughout the visa application process.",
            },
            {
              title: "Flight Bookings",
              text: "Assistance with inbound and outbound flight arrangements.",
            },
            {
              title: "Hotel Bookings",
              text: "Hotel accommodation arrangements for local and international travel.",
            },
            {
              title: "Kenya Tours",
              text: "Tours and travel experiences for local clients and visitors exploring Kenya.",
            },
          ].map((service) => (
            <div
              key={service.title}
              className="rounded-2xl border border-slate-200 p-6"
            >
              <h3 className="text-lg font-bold">{service.title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {service.text}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-12 md:grid-cols-2">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">
                About us
              </p>

              <h2 className="mt-3 text-3xl font-bold">
                Grandvic Tours and Travel
              </h2>

              <p className="mt-5 leading-7 text-slate-600">
                Grandvic Tours and Travel operates as a trading name of
                WINDBECK ENTERPRISES LTD, providing travel-related services
                from Nairobi, Kenya.
              </p>

              <p className="mt-4 leading-7 text-slate-600">
                Our services are designed to help individuals, families,
                groups and visitors plan and manage their travel needs.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-8">
              <h3 className="text-xl font-bold">Contact information</h3>

              <div className="mt-6 space-y-4 text-sm text-slate-600">
                <p>
                  <strong className="text-slate-900">Business:</strong>{" "}
                  WINDBECK ENTERPRISES LTD
                </p>

                <p>
                  <strong className="text-slate-900">Trading name:</strong>{" "}
                  Grandvic Tours and Travel
                </p>

                <p>
                  <strong className="text-slate-900">Location:</strong>{" "}
                  Nairobi, Kenya
                </p>

                <p>
                  <strong className="text-slate-900">Email:</strong>{" "}
                  grandvictoursandtravel@gmail.com
                </p>

                <p>
                  <strong className="text-slate-900">Phone:</strong>{" "}
                  +254 117 719426
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} WINDBECK ENTERPRISES LTD. All rights
            reserved.
          </p>

          <p>Grandvic Tours and Travel</p>
        </div>
      </footer>
    </main>
  );
}