# How reliable is RAM??? (and proof that AI learning from the internet is a bad idea)

Its a bad vibe when your radiation machine flips is strength setting from 5 to 133 because one bit flipped. Or maybe one bit turns your $10 deposit into a -$2,147,483,638 withdrawl.

```
Decimal |  Binary 
5         00000101      
133       10000101

(2's compliment)
Decimal      |              Binary
+10             00000000000000000000000000001010
-2147483638     10000000000000000000000000001010
```

In reality, good programs check data at many steps of the process, ensuring safe behavior in any unexpected circumstance. But lots of programs are built more simply. 

## __I'm curious how common a RAM bit flip is in the average experience of an average user.__

The inspiration for this investigation came from this event in 2013:

<iframe width="560" height="315" src="https://www.youtube.com/embed/bhBf5crp0i8?si=S_n_JAchit8QArQh&amp;start=8" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>

A moment in [SMB64]() [speedrunning]() where mario seemingly teleports for no reason, saving time in the race. The speedrunning community ended up [recreating this exact](https://youtu.be/X5cwuYFUUAY) moment by manually flipping a single bit from C5 -> C4.
```
Decimal | HEX
197       C5
196       C4
```

The vast majority of the internet claims **__COSMIC RAY INTERVENTION.__**

> This is usually called a **Single Event Upset**.

This great [Veritasium video](https://youtu.be/AaZ_RSt0KP8?si=ZsEFT5lE5HrtOSyK) explains the effect. Including a story of election results in Berlin.

## But how many of our everyday computer bugs and crashes from this kind of phenomenon?

With a quick google search you find the ever trustworthy AI generated response.
![Google Search for bit flips](image.png)

Thats crazy, if that number is correct then every device almost always has a bit flip every week. (Because most consumer devices have more than 4GB of RAM)

Digging deeper I found a [competing google paper](https://www.cs.toronto.edu/~bianca/papers/sigmetrics09.pdf). Basically, it says that bit flips happen almost never, and, if they do, it's likely due to a hardware problem that will lead to many more bit flips on that specific RAM stick. Additionally, a blog post on [robertelkder.org](https://blog.robertelder.org/causes-of-bit-flips-in-computer-memory/#:~:text=If%20you%20do%20a%20search,bit%20flip%20every%20three%20days%22.) claims that the situation has to be perfect for cosmic rays to intervene. Robert has lots of pictures so it seems trustworthly. But I have genuinely no clue if he is right.

## So I decided to test it myself!

<img src="lab.jpg" alt="drawing" heigth="300px"/>

Basically, I've set up a test bench to just allocate 10(ish) Gigs of RAM, set it all to 00000000 and check every once in a while to see if anything changed. Its a super simple setup. But I wanted to just sit a wait and see if I could get any __alpha particle__ related flips. Feel free to check out my code on github [github.com/danbotMBM/bitflip_lab](https://github.com/danbotMBM/bitflip_lab/blob/master/mem_check.c).

# Results

### **__Nothing happened!!__**

Its been running for a couple months now and not a single bit is flipped. I think I've set everything up correctly with the code. But please reach out if you have any thoughs.

## Implementation details

Here are just some details on what when into the development

1. Turn off the memory being able to be moved to the SWAP partition
2. Calloc the RAM
3. Make a hashtable to keep track of the bytes that have flipped already
   1. I made the hashtable myself just to brush up on my C skills
4. Check every once in a while
5. Make a transaction list for historical purposes
6. Load the transaction list if the program restarts
7. Make a systemd unit file to run on boot
8. Make a python program to email me when a bit flips

