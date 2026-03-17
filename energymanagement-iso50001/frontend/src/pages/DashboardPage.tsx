export default function DashboardPage() {
  return (
    <div>
      <h1 className="page-title">Dashboard</h1>
      <p className="mt-2 text-gray-500">
        Übersicht über Energieverbrauch, CO₂-Emissionen und Kennzahlen.
      </p>

      {/* TODO: KPI-Karten, Verbrauchscharts, Energieaufteilung */}
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {['Gesamtverbrauch', 'CO₂-Emissionen', 'Kosten', 'EnPI'].map((title) => (
          <div key={title} className="card">
            <p className="text-sm text-gray-500">{title}</p>
            <p className="mt-2 text-2xl font-semibold text-gray-400">–</p>
          </div>
        ))}
      </div>
    </div>
  );
}
