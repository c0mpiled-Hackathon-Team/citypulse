export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-4 px-4 py-16">
      <p className="text-sm font-medium text-rose-600">Taipei 1999 hotline</p>
      <h1 className="text-4xl font-semibold tracking-tight">CityPulse</h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">
        Describe a problem in your neighbourhood. CityPulse routes it to the right office and puts it on
        the city map.
      </p>
    </main>
  );
}
