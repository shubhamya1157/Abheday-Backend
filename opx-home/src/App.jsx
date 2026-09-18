import { useEffect, useRef, useState } from "react";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import HowItWorks from "@/components/HowItWorks";
import Features from "@/components/Features";
import Faq from "@/components/Faq";
import Footer from "@/components/Footer";

// The page is two rooms with one line between them.
//
// Room 1 is paper: the plant office, where the paperwork lives. Room 2 is
// almost black: the machine room, where OPX actually runs. You cross from
// one to the other exactly once, and the navbar repaints when you do.

export default function App() {
  const heroRef = useRef(null);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    function onScroll() {
      const hero = heroRef.current;
      if (!hero) return;
      // flip just as the cream block finishes leaving the top of the screen
      setDark(window.scrollY > hero.offsetHeight - 120);
    }

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // this only colours the page behind everything, so overscroll at the top
  // and the bottom matches the room you are standing in
  useEffect(() => {
    document.body.classList.toggle("room-plant", dark);
  }, [dark]);

  return (
    <>
      <Navbar dark={dark} />

      <div ref={heroRef}>
        <Hero />
      </div>

      <main className="bg-plant">
        <HowItWorks />
        <Features />
        <Faq />
        <Footer />
      </main>
    </>
  );
}
