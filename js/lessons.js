// Starter lessons shown to students. You (the teacher) will teach the
// real content live on video call — these are just quick reference
// cards + starter code so kids can practice on their own between classes.
// Feel free to edit this list any time; it's a plain JS file.
window.LESSONS = [
  {
    id: "l1",
    title_en: "Say Hello",
    title_te: "హలో చెప్పండి",
    body_en: "Use print() to show text on the screen. Try changing the message!",
    body_te: "తెరపై టెక్స్ట్ చూపించడానికి print() ఉపయోగించండి. సందేశాన్ని మార్చి చూడండి!",
    starter: 'print("Hello, Srikakulam!")\nprint("My name is ___")'
  },
  {
    id: "l2",
    title_en: "Numbers & Math",
    title_te: "సంఖ్యలు & గణితం",
    body_en: "Python can add, subtract, multiply and divide. Try your own numbers.",
    body_te: "పైథాన్ కూడిక, తీసివేత, గుణకారం, భాగహారం చేయగలదు. మీ సొంత సంఖ్యలతో ప్రయత్నించండి.",
    starter: "a = 12\nb = 4\nprint(\"Sum:\", a + b)\nprint(\"Difference:\", a - b)\nprint(\"Product:\", a * b)\nprint(\"Divide:\", a / b)"
  },
  {
    id: "l3",
    title_en: "Variables",
    title_te: "వేరియబుల్స్",
    body_en: "A variable stores a value with a name, like a labeled box.",
    body_te: "వేరియబుల్ అనేది ఒక పేరుతో విలువను నిల్వ చేస్తుంది, లేబుల్ ఉన్న పెట్టెలా.",
    starter: 'name = "Ravi"\nage = 11\nprint(name, "is", age, "years old")'
  },
  {
    id: "l4",
    title_en: "If / Else Decisions",
    title_te: "if / else నిర్ణయాలు",
    body_en: "Python can make decisions using if and else.",
    body_te: "పైథాన్ if మరియు else ఉపయోగించి నిర్ణయాలు తీసుకోగలదు.",
    starter: "marks = 78\nif marks >= 35:\n    print(\"Pass\")\nelse:\n    print(\"Try again\")"
  },
  {
    id: "l5",
    title_en: "Loops",
    title_te: "లూప్‌లు",
    body_en: "A loop repeats an action. This counts from 1 to 5.",
    body_te: "లూప్ ఒక చర్యను పునరావృతం చేస్తుంది. ఇది 1 నుండి 5 వరకు లెక్కిస్తుంది.",
    starter: "for i in range(1, 6):\n    print(\"Count:\", i)"
  },
  {
    id: "l6",
    title_en: "Mini Project: Name Game",
    title_te: "మినీ ప్రాజెక్ట్: పేరు ఆట",
    body_en: "Combine everything you learned to greet your friends by name in a loop.",
    body_te: "మీరు నేర్చుకున్న అన్నింటినీ కలిపి లూప్‌లో మీ స్నేహితులను పేరుతో పలకరించండి.",
    starter: 'friends = ["Sita", "Ravi", "Lakshmi"]\nfor friend in friends:\n    print("Namaste,", friend + "!")'
  }
];
