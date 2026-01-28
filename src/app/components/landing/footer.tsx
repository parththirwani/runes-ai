const Footer = () => {
  return (
    <footer className="bg-background pt-4 pb-6 px-6 md:px-12 overflow-hidden relative">
      <div className="flex items-center justify-between mb-16 md:mb-20">
        <div className="flex items-center">
          <img
            src="/small-logo.png"
            alt="Runes AI Logo"
            className="w-28 h-28 sm:w-40 sm:h-40 md:w-48 md:h-48 lg:w-64 lg:h-64 xl:w-72 xl:h-56 object-contain transition-all duration-300 hover:scale-105 hover:drop-shadow-[0_0_20px_rgba(0,255,180,0.5)]"
            width={200}   
            height={200}
          />
        </div>
        <div className="flex gap-10 md:gap-8">
          <a
            href="#"
            className="text-muted-foreground hover:text-primary hover:drop-shadow-[0_0_12px_hsl(160,85%,55%)] transition-all duration-300"
            aria-label="X (Twitter)"
          >
            <img
              src="/x.svg"
              alt="X (Twitter)"
              className="w-6 h-6 grey-social-icon"
              width={24}
              height={24}
            />
          </a>
          <a
            href="#"
            className="text-muted-foreground hover:text-primary hover:drop-shadow-[0_0_12px_hsl(160,85%,55%)] transition-all duration-300"
            aria-label="GitHub"
          >
            <img
              src="/github.svg"
              alt="GitHub"
              className="w-6 h-6 grey-social-icon"
              width={24}
              height={24}
            />
          </a>
          <a
            href="#"
            className="text-muted-foreground hover:text-primary hover:drop-shadow-[0_0_12px_hsl(160,85%,55%)] transition-all duration-300"
            aria-label="LinkedIn"
          >
            <img
              src="/linkedin.svg"
              alt="LinkedIn"
              className="w-6 h-6 grey-social-icon"
              width={24}
              height={24}
            />
          </a>
        </div>
      </div>

      <div className="relative w-full">
        <h1
          className="mirror-text text-[clamp(14vw,18vw,220px)] font-black leading-[0.82] tracking-[-0.04em] text-foreground select-none whitespace-nowrap text-center"
          data-text="Runes AI"
        >
          <span className="relative inline-block">
            Runes AI
            <span
              className="absolute left-0 top-[2%] text-neon opacity-70 blur-xs pointer-events-none"
              aria-hidden="true"
            >
              R
            </span>
          </span>
        </h1>
        <div className="absolute -bottom-2 md:-bottom-3 left-1/2 -translate-x-1/2 w-1/4 md:w-1/5 h-px gradient-line opacity-30" />
      </div>
    </footer>
  );
};

export default Footer;