import { ConverterForm } from "@/components/ConverterForm";
import { Bot, MessageSquare, Zap, Shield, FileOutput } from "lucide-react";
import { motion } from "framer-motion";

export default function Home() {
  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Abstract Background Shapes */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[600px] h-[600px] rounded-full bg-accent/5 blur-3xl" />
      </div>

      <div className="container mx-auto px-4 py-12 relative z-10">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center space-y-4 mb-12"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            <Zap className="w-4 h-4" />
            <span>Fast & Secure Conversion</span>
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
            TXT to <span className="text-gradient">VCF Converter</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Transform your raw text lists into compatible contact files in seconds. 
            Automated splitting, custom naming, and instant download.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <ConverterForm />
        </motion.div>

        {/* Feature Grid */}
        <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-8">
          <FeatureCard 
            icon={<FileOutput className="w-8 h-8 text-primary" />}
            title="Smart Splitting"
            description="Automatically splits large contact lists into smaller, manageable files based on your preferences."
          />
          <FeatureCard 
            icon={<Shield className="w-8 h-8 text-accent" />}
            title="Privacy First"
            description="Your files are processed securely and deleted immediately after conversion. We don't store your data."
          />
          <FeatureCard 
            icon={<Bot className="w-8 h-8 text-blue-500" />}
            title="Telegram Integration"
            description="This tool is powered by the same engine as our Telegram bot. Use it directly from your chat app."
          />
        </div>

        {/* Telegram Bot Promo Section */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="mt-20 rounded-3xl bg-gradient-to-br from-slate-900 to-slate-800 text-white p-8 md:p-12 text-center relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/20 blur-3xl rounded-full translate-x-1/2 -translate-y-1/2" />
          
          <div className="relative z-10 max-w-3xl mx-auto space-y-6">
            <div className="flex justify-center mb-6">
              <div className="bg-white/10 p-4 rounded-2xl backdrop-blur-sm">
                <MessageSquare className="w-12 h-12 text-white" />
              </div>
            </div>
            <h2 className="text-3xl font-bold">Prefer using Telegram?</h2>
            <p className="text-slate-300 text-lg">
              You can access this same functionality directly through our Telegram bot. 
              Just send a .txt file, and the bot will do the rest instantly.
            </p>
            <div className="pt-4">
              <a 
                href="#" 
                className="inline-flex items-center gap-2 bg-white text-slate-900 hover:bg-white/90 px-8 py-3 rounded-xl font-bold transition-all hover:scale-105 active:scale-95"
                onClick={(e) => e.preventDefault()} // Placeholder link
              >
                <Bot className="w-5 h-5" />
                Start Bot (Coming Soon)
              </a>
            </div>
          </div>
        </motion.div>
      </div>

      <footer className="mt-20 py-8 border-t border-border/50 text-center text-muted-foreground">
        <p>© 2024 TXT to VCF Converter. Built for efficiency.</p>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="p-6 rounded-2xl bg-card border border-border/50 hover:shadow-lg hover:border-primary/20 transition-all duration-300 group">
      <div className="mb-4 p-3 rounded-xl bg-background w-fit group-hover:scale-110 transition-transform duration-300 border border-border/50">
        {icon}
      </div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}
